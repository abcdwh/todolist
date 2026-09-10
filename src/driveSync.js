/*!
 * 오늘할일 - Google 드라이브 동기화 모듈
 * Copyright (c) 2026 Kimwonhee. All rights reserved.
 *
 * drive.appdata 스코프만 사용합니다.
 * 사용자 드라이브의 앱 전용 숨김 폴더에만 접근하며,
 * 사용자의 다른 파일은 조회조차 불가능합니다.
 */

const DriveSync = {
  CLIENT_ID: '453650035215-cpu8uik8e0vv3ddid73ridb58rbmumbo.apps.googleusercontent.com',
  SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
  FILE_NAME: 'todo-data.json',

  tokenClient: null,
  accessToken: null,
  tokenExpiresAt: 0,
  fileId: null,
  isReady: false,

  // ---------- 초기화 ----------
  async init() {
    await this.waitForGis();
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.CLIENT_ID,
      scope: this.SCOPE,
      callback: () => {} // requestToken() 에서 매번 교체
    });
    this.isReady = true;
  },

  waitForGis() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다.'));
        }
      }, 100);
    });
  },

  // 사용자가 한 번이라도 연결한 적이 있는지 (기기별 기록)
  wasConnected() {
    return localStorage.getItem('todomemo_drive_connected') === '1';
  },

  markConnected(v) {
    if (v) localStorage.setItem('todomemo_drive_connected', '1');
    else localStorage.removeItem('todomemo_drive_connected');
  },

  isSignedIn() {
    return !!this.accessToken && Date.now() < this.tokenExpiresAt;
  },

  /**
   * 액세스 토큰 요청
   * @param {boolean} interactive true면 동의 팝업을 띄움, false면 조용히 갱신만 시도
   */
  requestToken(interactive) {
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) {
        reject(new Error('아직 초기화되지 않았습니다.'));
        return;
      }

      this.tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        this.accessToken = response.access_token;
        // 만료 1분 전을 만료로 간주 (안전 여유)
        const ttl = Number(response.expires_in || 3600);
        this.tokenExpiresAt = Date.now() + (ttl - 60) * 1000;
        this.markConnected(true);
        resolve(this.accessToken);
      };

      this.tokenClient.error_callback = (err) => {
        reject(new Error(err && err.type ? err.type : 'popup_failed'));
      };

      try {
        this.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) {
        reject(e);
      }
    });
  },

  async ensureToken() {
    if (this.isSignedIn()) return this.accessToken;
    return this.requestToken(false);
  },

  async signIn() {
    return this.requestToken(true);
  },

  async signOut() {
    const token = this.accessToken;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.fileId = null;
    this.markConnected(false);
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try {
        google.accounts.oauth2.revoke(token, () => {});
      } catch (e) {
        console.warn('토큰 취소 실패:', e);
      }
    }
  },

  // ---------- 드라이브 파일 입출력 ----------
  async apiFetch(url, options = {}) {
    const token = await this.ensureToken();
    const headers = Object.assign({}, options.headers, {
      Authorization: `Bearer ${token}`
    });
    const res = await fetch(url, Object.assign({}, options, { headers }));

    if (res.status === 401) {
      // 토큰 만료 → 한 번만 조용히 갱신 후 재시도
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      const retryToken = await this.requestToken(false);
      const retryHeaders = Object.assign({}, options.headers, {
        Authorization: `Bearer ${retryToken}`
      });
      return fetch(url, Object.assign({}, options, { headers: retryHeaders }));
    }
    return res;
  },

  async findFile() {
    if (this.fileId) return this.fileId;

    const url = 'https://www.googleapis.com/drive/v3/files'
      + '?spaces=appDataFolder'
      + `&q=${encodeURIComponent(`name='${this.FILE_NAME}' and trashed=false`)}`
      + '&fields=files(id,modifiedTime)'
      + '&pageSize=1';

    const res = await this.apiFetch(url);
    if (!res.ok) throw new Error(`파일 조회 실패 (${res.status})`);

    const json = await res.json();
    if (json.files && json.files.length > 0) {
      this.fileId = json.files[0].id;
      return this.fileId;
    }
    return null;
  },

  async download() {
    const id = await this.findFile();
    if (!id) return null; // 아직 드라이브에 아무것도 없음

    const res = await this.apiFetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
    );
    if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);

    const text = await res.text();
    if (!text || !text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch (e) {
      // 드라이브 파일이 깨진 경우: 로컬을 신뢰하고 덮어쓰도록 null 반환
      console.error('드라이브 파일 파싱 실패:', e);
      return null;
    }
  },

  async upload(data) {
    const body = JSON.stringify(data);
    const id = await this.findFile();

    if (id) {
      const res = await this.apiFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body
        }
      );
      if (!res.ok) throw new Error(`업로드 실패 (${res.status})`);
      return;
    }

    // 최초 생성: 메타데이터 + 본문 멀티파트
    const boundary = 'todomemo' + Date.now();
    const metadata = {
      name: this.FILE_NAME,
      parents: ['appDataFolder'],
      mimeType: 'application/json'
    };

    const multipart =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      body + '\r\n' +
      `--${boundary}--`;

    const res = await this.apiFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipart
      }
    );
    if (!res.ok) throw new Error(`파일 생성 실패 (${res.status})`);

    const json = await res.json();
    this.fileId = json.id;
  }
};

window.DriveSync = DriveSync;
