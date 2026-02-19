export class Main {
  /**
   * @param {{ demoFilename?: string, gpxUrl?: string, zoomThreshold?: number }} params
   */
  constructor(params = {}) {
    this.params = params;
    this.map = null;
    this.trackLayer = null;
    this.marker = null;
    this.timeControl = null;
    this.uploadControl = null;
    this.videoSizeControl = null;
    this.scaleControl = null;
    this.mapStampControl = null;
    this.speedHudControl = null;
    this.speedHudToggleControl = null;
    this.lastSpeedHudUpdateAt = 0;
    this.lastSpeedKnots = null;
    this.isSpeedHudEnabled = false;
    this.tideOverlay = null;
    this.tideToggleControl = null;
    this.sidebarToggleControl = null;
    this.isTideEnabled = false;
    this.currentTideYmd = null;
    this.currentTrackLatLng = null;
    this.currentTrackRepresentativeLatLng = null;
    this.currentPlaybackMs = null;
    this.hasEverAutoEnabledTide = false;
    this.tideUpdateRequestId = 0;
    this.infoPanel = null;
    this.currentTrackLabel = null;
    this.lastStats = {
      distanceMeters: null,
      durationMs: null,
      avgSpeedKnots: null,
    };
  }

  async initialize() {
    this.#initMap();
    this.#ensureSidebarToggleControl();
    this.#ensureUploadControl();
    this.#ensureVideoSizeControl();
    this.#ensureTideOverlay();
    this.#ensureTideToggleControl();
    this.#ensureSpeedHudToggleControl();
    this.#ensureInfoPanel();
    // 初期状態では「情報」UIを非表示
    try {
      this.#getInfoRoot().style.display = 'none';
    } catch {
      // ignore
    }
    // small delay to ensure Leaflet controls are rendered; then verify visibility
    try {
      this.#ensureLeafletControlsVisible();
    } catch {
      // ignore
    }
  }

  // Ensure Leaflet attribution/scale controls are present and visible on small/mobile browsers
  #ensureLeafletControlsVisible() {
    try {
      const ensure = () => {
        const mapEl = this.map?.getContainer ? this.map.getContainer() : document.getElementById('map');
        if (!mapEl) return;
        let attr = document.querySelector('.leaflet-control-attribution');
        if (!attr) {
          try { L.control.attribution({ prefix: false }).addTo(this.map); } catch {}
          attr = document.querySelector('.leaflet-control-attribution');
        }
        let scale = document.querySelector('.leaflet-control-scale');
        if (!scale) {
          try { L.control.scale({ imperial: false }).addTo(this.map); } catch {}
          scale = document.querySelector('.leaflet-control-scale');
        }
        [attr, scale].forEach((el) => {
          if (!el) return;
          try {
            el.style.display = 'block';
            el.style.zIndex = '9000';
            // if element is outside the map viewport, append it into the map container and position it
            const rect = el.getBoundingClientRect();
            const mapRect = mapEl.getBoundingClientRect();
            const isOutside = rect.right < mapRect.left || rect.left > mapRect.right || rect.bottom < mapRect.top || rect.top > mapRect.bottom;
            if (isOutside) {
              try {
                el.style.position = 'absolute';
                el.style.right = '12px';
                el.style.bottom = 'calc(6px + env(safe-area-inset-bottom, 0px))';
                el.style.left = '';
                el.style.top = '';
                mapEl.appendChild(el);
              } catch {}
            }
          } catch {}
        });
      };
      setTimeout(ensure, 350);
      window.addEventListener('resize', ensure, { passive: true });
      window.addEventListener('orientationchange', ensure, { passive: true });
    } catch {
      // ignore
    }
  }

  #getDemoUrl() {
    return this.params.demoFilename ?? this.params.gpxUrl ?? './data/kaichouzuV_route_10_20260217_134752.gpx';
  }

  #getUiRoot() {
    const el = document.getElementById('ui');
    if (!el) throw new Error('UIコンテナ(#ui)が見つかりません。');
    return el;
  }

  #getInfoRoot() {
    const el = document.getElementById('info');
    if (!el) throw new Error('情報コンテナ(#info)が見つかりません。');
    return el;
  }

  #ensureInfoPanel() {
    if (this.infoPanel) return;
    this.infoPanel = createInfoPanel(this.#getInfoRoot());
  }

  #ensureSidebarToggleControl() {
    if (!this.map) return;
    if (this.sidebarToggleControl) return;
    this.sidebarToggleControl = createSidebarToggleControl(this.map, {
      getOpen: () => {
        try {
          return document.body.classList.contains('gpxv-sidebar-open');
        } catch {
          return false;
        }
      },
      setOpen: (open) => {
        try {
          document.body.classList.toggle('gpxv-sidebar-open', Boolean(open));
        } catch {
          // ignore
        }
      },
    });
  }

  #clearCurrentTrack() {
    if (!this.map) return;
    if (this.timeControl) {
      try {
        this.timeControl.remove();
      } catch {
        // ignore
      }
      this.timeControl = null;
    }
    if (this.marker) {
      try {
        this.map.removeLayer(this.marker);
      } catch {
        // ignore
      }
      this.marker = null;
    }
    if (this.trackLayer) {
      try {
        this.map.removeLayer(this.trackLayer);
      } catch {
        // ignore
      }
      this.trackLayer = null;
    }
    this.currentPlaybackMs = null;
    this.currentTrackLatLng = null;
    this.currentTrackRepresentativeLatLng = null;
    this.lastStats = { distanceMeters: null, durationMs: null, avgSpeedKnots: null };
    this.lastSpeedKnots = null;
    try {
      this.mapStampControl?.setVisible?.(false);
    } catch {
      // ignore
    }
    try {
      this.speedHudControl?.setVisible?.(false);
    } catch {
      // ignore
    }
    try {
      this.speedHudToggleControl?.setVisible?.(false);
    } catch {
      // ignore
    }
    // クリア時は情報を隠す
    try {
      this.#getInfoRoot().style.display = 'none';
    } catch {
      // ignore
    }
  }

  #renderTrack(track, label = '') {
    if (!this.map) return;
    const latlngs = track.latlngs;
    if (!latlngs.length) {
      throw new Error(`GPXに座標点が見つかりませんでした: ${label}`);
    }
    this.#clearCurrentTrack();
    this.currentTrackLabel = String(label || '').trim() || null;
    this.currentTrackLatLng = latlngs[0] ?? null;
    this.currentTrackRepresentativeLatLng = computeMedianLatLng(latlngs) ?? this.currentTrackLatLng;
    this.#ensureInfoPanel();
    try {
      this.#getInfoRoot().style.display = 'block';
    } catch {
      // ignore
    }

    // 情報パネル（timeが無い場合も距離と座標は出す）
    try {
      const totalMeters = computePathDistanceMeters(latlngs);
      this.infoPanel?.setDistanceMeters(totalMeters);
      this.infoPanel?.setDurationMs(null);
      this.infoPanel?.setAvgSpeedKnots(null);
      this.infoPanel?.setGpsLatLng(latlngs[0] ?? null);
    } catch {
      // ignore
    }
    try {
      this.lastStats = { distanceMeters: null, durationMs: null, avgSpeedKnots: null };
    } catch {
      // ignore
    }

    // 全体の軌跡（ベース）
    // - timeあり: 速度に応じて線色をグラデーション（速い=明るい、遅い=暗い）
    // - timeなし: 従来どおり単色
    if (Array.isArray(track.timesMs) && track.timesMs.length) {
      this.trackLayer = createSpeedGradientTrackLayer(latlngs, track.timesMs, {
        bins: 24,
        weight: 3,
        opacity: 0.82,
        unknownOpacity: 0.18,
      });
    } else {
      this.trackLayer = L.polyline(latlngs, {
        // 選択区間（開始〜終了）を上に重ねて強調できるよう、ベースは薄く細く
        color: '#000000',
        weight: 2,
        opacity: 0.18,
      });
    }
    this.trackLayer.addTo(this.map);
    this.map.fitBounds(this.trackLayer.getBounds(), { padding: [20, 20] });

    // 時刻スライダ + マーカー（GPXにtimeがある場合）
    if (track.timesMs.length) {
      const speedTimeIndex = buildTimeIndex(track.timesMs);
      const speedHalfWindowMs = 30_000;
      try {
        this.speedHudToggleControl?.setVisible?.(true);
        this.speedHudControl?.setVisible?.(this.isSpeedHudEnabled);
        this.speedHudControl?.setSpeedKnots?.(this.lastSpeedKnots);
      } catch {
        // ignore
      }
      this.marker = L.marker(latlngs[0], { icon: createCuteMarkerIcon() }).addTo(this.map);
      this.timeControl = createTimeSliderControl(
        this.map,
        this.#getUiRoot(),
        {
          latlngs: track.latlngs,
          timesMs: track.timesMs,
          marker: this.marker,
        },
        {
          onStats: ({ distanceMeters, durationMs, avgSpeedKnots, latlng }) => {
            this.lastStats = {
              distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
              durationMs: Number.isFinite(durationMs) ? durationMs : null,
              avgSpeedKnots: Number.isFinite(avgSpeedKnots) ? avgSpeedKnots : null,
            };
            this.infoPanel?.setDistanceMeters(distanceMeters);
            this.infoPanel?.setDurationMs(durationMs);
            this.infoPanel?.setAvgSpeedKnots(avgSpeedKnots);
            this.infoPanel?.setGpsLatLng(latlng);
            try {
              this.#syncMapStamp();
            } catch {
              // ignore
            }
          },
          onTime: (ms) => {
            this.currentPlaybackMs = Number.isFinite(ms) ? Number(ms) : null;
            try {
              if (!this.isSpeedHudEnabled) {
                this.speedHudControl?.setVisible?.(false);
              } else {
                this.speedHudControl?.setVisible?.(true);
              }
              if (!this.isSpeedHudEnabled) {
                // 非表示中は計算しない
              } else {
                const now = performance.now();
                if (now - (this.lastSpeedHudUpdateAt ?? 0) >= 120) {
                  this.lastSpeedHudUpdateAt = now;
                  const knots = computeRollingAvgSpeedKnots(track, speedTimeIndex, ms, speedHalfWindowMs);
                  this.lastSpeedKnots = Number.isFinite(knots) ? knots : null;
                  this.speedHudControl?.setSpeedKnots?.(knots);
                }
              }
            } catch {
              // ignore
            }
            try {
              this.#syncMapStamp();
            } catch {
              // ignore
            }
            if (!this.isTideEnabled) return;
            try {
              this.tideOverlay?.setCursorTime?.(ms);
            } catch {
              // ignore
            }
          },
        }
      );
    } else {
      console.warn('GPXにtime要素が見つからなかったため、時間スライダは表示しません。');
      try {
        this.speedHudControl?.setVisible?.(false);
      } catch {
        // ignore
      }
      try {
        this.speedHudToggleControl?.setVisible?.(false);
      } catch {
        // ignore
      }
    }

    // 潮汐（GPXの日付で取得。トグルONのときのみ表示）
    this.#syncTideDateFromTrack(track);
    this.#onTrackLoadedForTide();
    this.#maybeUpdateTide();
  }

  #onTrackLoadedForTide() {
    // 初期状態では潮汐パネル（トグルUI）を非表示にし、GPXロード後に表示する
    try {
      this.tideToggleControl?.setVisible?.(true);
    } catch {
      // ignore
    }

    // 初回のGPXロード時は自動で潮汐をON（GPX日付が取れる場合のみ）
    if (this.hasEverAutoEnabledTide) return;
    if (!this.currentTideYmd) return;
    this.hasEverAutoEnabledTide = true;
    this.isTideEnabled = true;
    try {
      this.tideToggleControl?.sync?.();
    } catch {
      // ignore
    }
  }

  #ensureTideOverlay() {
    if (!this.map) return;
    if (this.tideOverlay) return;
    this.tideOverlay = createTideOverlayControl(this.map);
    // 初期状態では表示しない
    this.tideOverlay.hide();
  }

  #ensureTideToggleControl() {
    if (!this.map) return;
    if (this.tideToggleControl) return;
    this.tideToggleControl = createTideToggleControl(this.#getUiRoot(), {
      getEnabled: () => this.isTideEnabled,
      onToggle: (enabled) => {
        this.isTideEnabled = Boolean(enabled);
        this.#maybeUpdateTide();
      },
    });
    // 初期状態では潮汐パネルを非表示
    try {
      this.tideToggleControl.setVisible(false);
    } catch {
      // ignore
    }
  }

  #syncTideDateFromTrack(track) {
    const ms = Array.isArray(track?.timesMs) ? track.timesMs.find((v) => Number.isFinite(v)) : null;
    if (!Number.isFinite(ms)) {
      this.currentTideYmd = null;
      return;
    }
    try {
      this.currentTideYmd = formatYmdJst(ms);
    } catch {
      this.currentTideYmd = null;
    }
  }

  #maybeUpdateTide() {
    if (!this.tideOverlay) return;
    if (!this.isTideEnabled) {
      this.tideOverlay.hide();
      return;
    }
    const ymd = this.currentTideYmd;
    if (!ymd) {
      // 取得も表示もしない
      this.tideOverlay.hide();
      return;
    }
    this.#maybeUpdateTideAsync(ymd);
  }

  async #maybeUpdateTideAsync(ymd) {
    if (!this.tideOverlay) return;
    const reqId = ++this.tideUpdateRequestId;
    if (!this.isTideEnabled) {
      this.tideOverlay.hide();
      return;
    }
    const ll = this.currentTrackRepresentativeLatLng ?? this.currentTrackLatLng;
    const fallback = { pc: 14, hc: 16, isSeed: false, seedData: null };
    let resolved = fallback;
    try {
      resolved = (await resolveNearestTidePortForLatLng(ll, ymd)) ?? fallback;
    } catch {
      resolved = fallback;
    }
    if (reqId !== this.tideUpdateRequestId) return;
    if (!this.isTideEnabled) return;

    // 成功したら表示、失敗したら表示しない
    try {
      if (resolved.isSeed && resolved.seedData && this.tideOverlay.renderData) {
        this.tideOverlay.renderData(resolved.seedData);
      } else {
        const pc = Number.isFinite(resolved.pc) ? resolved.pc : 14;
        const hc = Number.isFinite(resolved.hc) ? resolved.hc : 16;
        this.tideOverlay.loadAndRender({ ymd, pc, hc, rg: 'day' });
      }
    } catch {
      try {
        this.tideOverlay.hide();
      } catch {
        // ignore
      }
      return;
    }

    if (Number.isFinite(this.currentPlaybackMs)) {
      try {
        this.tideOverlay.setCursorTime(this.currentPlaybackMs);
      } catch {
        // ignore
      }
    }
  }

  #ensureUploadControl() {
    if (!this.map) return;
    if (this.uploadControl) return;
    this.uploadControl = createGpxUploadControl(
      this.#getUiRoot(),
      async ({ name, text }) => {
        try {
          const track = parseGpxText(text, name);
          this.#renderTrack(track, name);
        } catch (err) {
          console.error('GPXアップロードの処理に失敗しました:', err);
          throw err;
        }
      },
      async () => {
        const demoUrl = this.#getDemoUrl();
        const track = await loadGpxTrack(demoUrl);
        this.#renderTrack(track, demoUrl);
      }
    );
  }

  #ensureVideoSizeControl() {
    if (!this.map) return;
    if (this.videoSizeControl) return;
    this.videoSizeControl = createVideoSizeControl(
      this.#getUiRoot(),
      {
        map: this.map,
      },
      {
        onExport: async () => {
          await this.#exportMapImage();
        },
        onShortsChanged: (enabled) => {
          try {
            this.#syncScalePosition(Boolean(enabled));
          } catch {
            // ignore
          }
        },
      }
    );
  }

  #ensureSpeedHudToggleControl() {
    if (!this.map) return;
    if (this.speedHudToggleControl) return;
    this.speedHudToggleControl = createSpeedHudToggleControl(this.#getUiRoot(), {
      getEnabled: () => this.isSpeedHudEnabled,
      onToggle: (enabled) => {
        this.isSpeedHudEnabled = Boolean(enabled);
        try {
          this.speedHudControl?.setVisible?.(this.isSpeedHudEnabled);
          this.speedHudControl?.setSpeedKnots?.(this.lastSpeedKnots);
        } catch {
          // ignore
        }
      },
    });
    // 初期状態では非表示（GPXロード後に表示する）
    try {
      this.speedHudToggleControl.setVisible(false);
    } catch {
      // ignore
    }
  }

  #syncMapStamp() {
    if (!this.mapStampControl) return;
    const ms = Number.isFinite(this.currentPlaybackMs) ? this.currentPlaybackMs : null;
    if (!Number.isFinite(ms)) return;
    const date = formatDateJst(ms);
    const time = formatTimeJst(ms);
    const distanceText = Number.isFinite(this.lastStats?.distanceMeters) ? formatDistanceMeters(this.lastStats.distanceMeters) : '-';
    const speedText = Number.isFinite(this.lastStats?.avgSpeedKnots) ? `${this.lastStats.avgSpeedKnots.toFixed(2)} kn` : '-';
    this.mapStampControl.setData({ date, time, distanceText, speedText });
  }

  #syncScalePosition(shortsEnabled) {
    if (!this.map) return;
    const desired = shortsEnabled ? 'topright' : 'bottomright';
    if (this.scaleControl) {
      try {
        this.scaleControl.remove();
      } catch {
        // ignore
      }
      this.scaleControl = null;
    }
    try {
      this.scaleControl = L.control.scale({ position: desired, metric: true, imperial: false, maxWidth: 160 }).addTo(this.map);
    } catch {
      // ignore
    }
  }

  async #exportMapImage() {
    const root = document.getElementById('map');
    if (!root) throw new Error('キャプチャ対象(#map)が見つかりません。');
    // レイアウト/タイル反映待ち（Leaflet + flex 配置向け）
    try {
      this.map?.invalidateSize?.();
    } catch {
      // ignore
    }
    // スタンプは「画像保存時だけ」表示する
    const hasStamp = Boolean(this.mapStampControl);
    try {
      if (hasStamp) {
        try {
          this.#syncMapStamp();
          this.mapStampControl?.setVisible?.(true);
        } catch {
          // ignore
        }
      }
      await settleLeafletForCapture(this.map);
      // 表示切替直後の反映待ち
      await nextAnimationFrame();
      const filename = buildExportFilename(this.currentTrackLabel);
      await downloadElementAsPng(root, filename);
    } finally {
      if (hasStamp) {
        try {
          this.mapStampControl?.setVisible?.(false);
        } catch {
          // ignore
        }
      }
    }
  }

  #initMap() {
    if (this.map) return;

    this.map = L.map('map', {
      zoomControl: true,
      // ズーム段階を細かくする（例: 0.25刻み）
      // - zoomSnap: 実際に止まるズーム値の刻み
      // - zoomDelta: +/- ボタン等の1ステップ量
      zoomSnap: 0.25,
      zoomDelta: 0.25,
      // マウスホイールズームも「0.25刻み」相当にする（ホイール入力量→ズーム量を抑える）
      // Leaflet はホイールの累積ピクセル量でズームを決めるため、ここを大きくすると 1回のホイール操作あたりのズーム量が小さくなる。
      // 既定値(60)の約4倍にして、体感で 0.25 step になるように調整。
      wheelPxPerZoomLevel: 240,
      // html2canvas が Leaflet の SVG ベクタを取りこぼす環境があるため、Canvasを優先
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);

    // 距離目盛り（縮尺）
    this.#syncScalePosition(false);

    // 画像用スタンプ（地図上ラベル）
    try {
      this.mapStampControl = createMapStampControl(this.map, { position: 'topleft' });
      this.mapStampControl.setVisible(false);
    } catch {
      // ignore
    }

    // 現在速度HUD（地図上）
    try {
      this.speedHudControl = createSpeedHudControl(this.map, { position: 'topleft' });
      this.speedHudControl.setVisible(false);
    } catch {
      // ignore
    }

    // GPXロード前の仮表示（ロード後にfitBoundsで追従）
    this.map.setView([35.681236, 139.767125], 10);
    // flexレイアウト下でサイズが確定してから再計算
    requestAnimationFrame(() => {
      try {
        this.map?.invalidateSize?.();
      } catch {
        // ignore
      }
    });
  }
}

function createSidebarToggleControl(map, opts = {}) {
  const control = L.control({ position: 'topleft' });
  let button = null;

  const getOpen = typeof opts.getOpen === 'function' ? opts.getOpen : () => false;
  const setOpen = typeof opts.setOpen === 'function' ? opts.setOpen : () => {};

  const sync = () => {
    if (!button) return;
    const isOpen = Boolean(getOpen());
    button.setAttribute('aria-pressed', String(isOpen));
    button.setAttribute('aria-label', isOpen ? 'UIパネルを閉じる' : 'UIパネルを開く');
  };

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'gpxv-sidebar-toggle leaflet-bar');
    button = L.DomUtil.create('button', '', container);
    button.type = 'button';
    button.textContent = '≡';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'UIパネルを開く');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(!getOpen());
      sync();
      try {
        map?.invalidateSize?.();
      } catch {
        // ignore
      }
    });
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // 初期同期
    try {
      sync();
    } catch {
      // ignore
    }
    return container;
  };

  try {
    control.addTo(map);
  } catch {
    // ignore
  }

  return { control, sync };
}

const tideCache = new Map();
let tidePortIndexPromise = null;

function dmToDecimalDegrees(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  const deg = Math.trunc(x);
  const minutes = (x - deg) * 100;
  // tide736の港座標は「度.分」(DD.MM) 形式のため、10進度へ変換
  // 例: 139.37 => 139°37' => 139.6166...
  if (!(minutes >= 0 && minutes < 60)) {
    // 10進度など、すでに変換済みの可能性
    return x;
  }
  return deg + minutes / 60;
}

function computeMedianLatLng(latlngs) {
  if (!Array.isArray(latlngs) || !latlngs.length) return null;
  const lats = [];
  const lons = [];
  for (const ll of latlngs) {
    const lat = Number(ll?.[0]);
    const lon = Number(ll?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    lats.push(lat);
    lons.push(lon);
  }
  if (!lats.length) return null;
  lats.sort((a, b) => a - b);
  lons.sort((a, b) => a - b);
  const mid = Math.floor(lats.length / 2);
  return [lats[mid], lons[mid]];
}

async function loadTidePortIndex() {
  if (tidePortIndexPromise) return tidePortIndexPromise;
  tidePortIndexPromise = (async () => {
    const res = await fetch('./data/code.csv');
    if (!res.ok) throw new Error(`code.csvの取得に失敗しました (${res.status} ${res.statusText})`);
    const text = await res.text();
    const lines = String(text).split(/\r?\n/).filter(Boolean);
    const header = lines.shift();
    if (!header) throw new Error('code.csvが空です');
    const ports = [];
    for (const line of lines) {
      const cols = line.split(',');
      if (cols.length < 6) continue;
      const pc = Number(cols[0]);
      const hc = Number(cols[1]);
      const prefName = String(cols[2] ?? '').trim();
      const harborName = String(cols[3] ?? '').trim();
      const lat = dmToDecimalDegrees(cols[4]);
      const lon = dmToDecimalDegrees(cols[5]);
      const tideType = cols.length >= 7 ? Number(cols[6]) : null;
      if (!Number.isFinite(pc) || !Number.isFinite(hc)) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      ports.push({ pc, hc, prefName, harborName, lat, lon, tideType: Number.isFinite(tideType) ? tideType : null });
    }
    if (!ports.length) throw new Error('code.csvから港リストを作れませんでした（緯度/経度列が必要です）');
    return { ports };
  })();
  return tidePortIndexPromise;
}

function pickNearestHarborFromCsv(lat, lon, ports) {
  const safeLat = Number(lat);
  const safeLon = Number(lon);
  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLon)) return null;
  if (!Array.isArray(ports) || !ports.length) return null;

  let best = ports[0];
  let bestD = haversineMeters(safeLat, safeLon, best.lat, best.lon);
  for (let i = 1; i < ports.length; i++) {
    const p = ports[i];
    const d = haversineMeters(safeLat, safeLon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { pc: best.pc, hc: best.hc };
}

/**
 * GPXの代表点(latlng)と日付(ymd)から、最寄りの潮汐港(pc/hc)を解決する。
 * `data/code.csv`（緯度/経度付き）の港一覧を使って、全港から最近傍を選ぶ。
 */
async function resolveNearestTidePortForLatLng(latlng, ymd) {
  if (!latlng || latlng.length < 2) return null;
  const lat = Number(latlng[0]);
  const lon = Number(latlng[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const idx = await loadTidePortIndex();
  const ports = idx?.ports ?? null;
  const nearestFromCsv = pickNearestHarborFromCsv(lat, lon, ports);
  if (!nearestFromCsv) return null;

  // code.csvの潮汐種別(=tide_type)を使って、同一都道府県コード内で type=1 を優先
  const safePc = Number(nearestFromCsv.pc);
  if (Number.isFinite(safePc) && Array.isArray(ports) && ports.length) {
    const type1PortsInPc = ports.filter((p) => p && p.pc === safePc && p.tideType === 1);
    const nearestType1 = pickNearestHarborFromCsv(lat, lon, type1PortsInPc);
    if (nearestType1) return { pc: nearestType1.pc, hc: nearestType1.hc, isSeed: false, seedData: null };
  }

  return { pc: nearestFromCsv.pc, hc: nearestFromCsv.hc, isSeed: false, seedData: null };
}

function formatYmdJst(ms) {
  const dt = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const y = get('year');
  const m = get('month');
  const d = get('day');
  if (!y || !m || !d) throw new Error('日付の抽出に失敗しました');
  return `${y}-${m}-${d}`;
}

function formatTimeHmJst(ms) {
  const dt = new Date(ms);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    // ja-JPでの区切りを避けるため明示
    hour12: false,
  }).format(dt);
}

async function fetchTide736Day({ ymd, pc, hc, rg }) {
  const [yr, mn, dy] = String(ymd).split('-').map((v) => Number(v));
  const url = new URL('https://tide736.net/api/get_tide.php');
  url.searchParams.set('pc', String(pc));
  url.searchParams.set('hc', String(hc));
  url.searchParams.set('yr', String(yr));
  url.searchParams.set('mn', String(mn));
  url.searchParams.set('dy', String(dy));
  url.searchParams.set('rg', String(rg));

  const cacheKey = url.toString();
  if (tideCache.has(cacheKey)) return tideCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`潮汐APIの取得に失敗しました (${res.status} ${res.statusText})`);
    const json = await res.json();
    if (!json || json.status !== 1) {
      throw new Error(`潮汐APIエラー: ${json?.message ?? 'unknown'}`);
    }
    const chart = json?.tide?.chart?.[ymd];
    const tide = chart?.tide;
    if (!Array.isArray(tide) || !tide.length) throw new Error('潮汐データが空です');
    const portName = json?.tide?.port?.harbor_namej ?? '';
    return { ymd, portName, tide };
  })();

  tideCache.set(cacheKey, promise);
  return promise;
}

function createTideOverlayControl(map) {
  const control = L.control({ position: 'bottomleft' });
  let container = null;
  let body = null;
  let statusEl = null;
  let svgWrap = null;
  let lastRequestId = 0;
  let isAdded = false;
  let scale = null;
  let cursorLineEl = null;
  let cursorTextEl = null;
  let pendingCursorMs = null;
  let isMapResizeHandlerBound = false;
  let isForcedFixed = false;

  const syncDisplaySize = () => {
    if (!container) return;
    // YouTube Shorts(9:16)は既存CSSで固定サイズ調整しているため、ここでは触らない
    try {
      if (document?.body?.classList?.contains?.('gpxv-shorts')) return;
    } catch {
      // ignore
    }

    let mapW = null;
    try {
      mapW = map?.getContainer?.()?.clientWidth ?? null;
    } catch {
      mapW = null;
    }
    if (!Number.isFinite(mapW) || mapW <= 0) return;

    // スマホ等の狭い画面だけ、地図幅の25%程度にする
    const isNarrow = (() => {
      try {
        return window?.matchMedia?.('(max-width: 768px)')?.matches ?? false;
      } catch {
        return false;
      }
    })();

    const baseW = 260;
    const baseH = 110;
    const ratio = baseH / baseW;
    const targetW = isNarrow ? mapW * 0.25 : baseW;
    const svgW = Math.max(1, Math.round(targetW));
    const svgH = Math.max(1, Math.round(svgW * ratio));
    container.style.setProperty('--gpxv-tide-svg-w', `${svgW}px`);
    container.style.setProperty('--gpxv-tide-svg-h', `${svgH}px`);
  };

  const ensureVisibleOnViewport = () => {
    try {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const isOutside = rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh;
      if (isOutside) {
        // align fixed container to map's bottom-left so it visually matches PC position
        const mapEl = map?.getContainer?.();
        if (mapEl) {
          const m = mapEl.getBoundingClientRect();
          const left = Math.max(8, Math.round(m.left + 8));
          const bottom = Math.max(8, Math.round(vh - m.bottom + 12));
          container.style.position = 'fixed';
          container.style.left = `${left}px`;
          container.style.bottom = `${bottom}px`;
          container.style.right = 'auto';
          container.style.top = 'auto';
          container.style.zIndex = '4000';
          isForcedFixed = true;
        } else {
          container.style.position = 'fixed';
          container.style.left = '12px';
          container.style.bottom = '92px';
          container.style.right = 'auto';
          container.style.top = 'auto';
          container.style.zIndex = '4000';
          isForcedFixed = true;
        }
      } else if (isForcedFixed) {
        // revert to default (let Leaflet control container manage positioning)
        container.style.position = '';
        container.style.right = '';
        container.style.bottom = '';
        container.style.left = '';
        container.style.top = '';
        container.style.zIndex = '';
        isForcedFixed = false;
      }
    } catch {
      // ignore
    }
  };

  control.onAdd = () => {
    container = L.DomUtil.create('div', 'gpxv-control gpxv-control--tide');
    body = L.DomUtil.create('div', 'gpxv-tide', container);
    statusEl = L.DomUtil.create('div', 'gpxv-status', body);
    statusEl.textContent = '未読み込み';
    svgWrap = L.DomUtil.create('div', 'gpxv-tide__chart', body);
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    // start hidden; show()/hide() will control visibility to avoid mobile stacking issues
    try {
      container.style.display = 'none';
    } catch {
      // ignore
    }

    // 初期サイズ同期（render前でもCSS変数はセットしておく）
    try {
      syncDisplaySize();
    } catch {
      // ignore
    }

    // 地図のリサイズ（端末回転/画面サイズ変更）に追従
    try {
      if (!isMapResizeHandlerBound) {
        isMapResizeHandlerBound = true;
        map?.on?.('resize', syncDisplaySize);
      }
    } catch {
      // ignore
    }
    // (debug duplicate removed)
    return container;
  };

  const show = () => {
    if (isAdded) return;
    try {
      control.addTo(map);
      isAdded = true;
    } catch {
      // ignore
    }
    try {
      if (container) {
        container.style.display = 'block';
        // ensure it's above other layers/overlays on mobile
        container.style.zIndex = '3500';
        container.style.pointerEvents = 'auto';
      }
    } catch {
      // ignore
    }
    // ensure visible; also bind a resize handler once
    try {
      ensureVisibleOnViewport();
      if (!isMapResizeHandlerBound) {
        window.addEventListener('resize', ensureVisibleOnViewport, { passive: true });
        isMapResizeHandlerBound = true;
      }
    } catch {
      // ignore
    }
  };

  const hide = () => {
    if (!isAdded) return;
    try {
      control.remove();
    } catch {
      // ignore
    }
    isAdded = false;
    try {
      if (container) container.style.display = 'none';
    } catch {
      // ignore
    }
    try {
      if (isForcedFixed && container) {
        container.style.position = '';
        container.style.right = '';
        container.style.bottom = '';
        container.style.left = '';
        container.style.top = '';
        container.style.zIndex = '';
        isForcedFixed = false;
      }
    } catch {
      // ignore
    }
    // no floating/debug duplicates to clean up
  };

  const setMessage = (text) => {
    if (statusEl) statusEl.textContent = String(text ?? '');
    if (svgWrap) svgWrap.innerHTML = '';
    scale = null;
    cursorLineEl = null;
    cursorTextEl = null;
  };

  const setLoading = (text) => {
    if (statusEl) statusEl.textContent = String(text ?? '読込中...');
  };

  const render = ({ ymd, portName, tide }) => {
    // render called
    show();
    if (!svgWrap) return;
    const points = tide
      .map((p) => ({
        t: Number(p?.unix),
        cm: Number(p?.cm),
        txt: String(p?.time ?? ''),
      }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.cm));
    if (!points.length) {
      setMessage('潮汐データがありません');
      return;
    }

    const w = 260;
    const h = 110;
    const margin = { top: 8, right: 8, bottom: 22, left: 38 };
    const innerW = Math.max(1, w - margin.left - margin.right);
    const innerH = Math.max(1, h - margin.top - margin.bottom);
    const minT = Math.min(...points.map((p) => p.t));
    const maxT = Math.max(...points.map((p) => p.t));
    const rawMinY = Math.min(...points.map((p) => p.cm));
    const rawMaxY = Math.max(...points.map((p) => p.cm));
    // 縦軸に上下余白を入れる（最大+α / 最小-α）
    const spanRawY = Math.max(1, rawMaxY - rawMinY);
    const alphaCm = Math.max(10, Math.round(spanRawY * 0.06));
    const minY = rawMinY - alphaCm;
    const maxY = rawMaxY + alphaCm;
    const spanT = Math.max(1, maxT - minT);
    const spanY = Math.max(1, maxY - minY);

    const x = (t) => margin.left + ((t - minT) / spanT) * innerW;
    const y = (cm) => margin.top + (1 - (cm - minY) / spanY) * innerH;

    const d = points
      .map((p, i) => {
        const cmd = i === 0 ? 'M' : 'L';
        return `${cmd} ${x(p.t).toFixed(2)} ${y(p.cm).toFixed(2)}`;
      })
      .join(' ');

    // 軸（x: 時刻, y: cm）
    const axisColor = 'rgba(0,0,0,0.70)';
    const tickColor = 'rgba(0,0,0,0.68)';
    const gridColor = 'rgba(0,0,0,0.55)';
    const fontSize = 10;
    const accent = '#0078A8';

    const yTicks = [minY, (minY + maxY) / 2, maxY];
    const yTickEls = yTicks
      .map((v) => {
        const yy = y(v);
        const label = `${Math.round(v)}cm`;
        return `
					<g>
						<line x1="${margin.left}" y1="${yy.toFixed(2)}" x2="${(w - margin.right).toFixed(2)}" y2="${yy.toFixed(2)}" stroke="${gridColor}" stroke-width="1" opacity="0.22" stroke-dasharray="2 3" />
						<text x="${(margin.left - 6).toFixed(2)}" y="${(yy + 3).toFixed(2)}" text-anchor="end" fill="${tickColor}" font-size="${fontSize}">${label}</text>
					</g>
				`;
      })
      .join('');

    const xTickTimes = [0, 6, 12, 18, 24].map((hh) => ({
      t: minT + hh * 60 * 60 * 1000,
      label: String(hh).padStart(2, '0'),
    })).filter((p) => p.t >= minT && p.t <= maxT + 1);
    const xTickEls = xTickTimes
      .map((p) => {
        const xx = x(p.t);
        const y0 = margin.top + innerH;
        return `
					<g>
						<line x1="${xx.toFixed(2)}" y1="${margin.top.toFixed(2)}" x2="${xx.toFixed(2)}" y2="${y0.toFixed(2)}" stroke="${gridColor}" stroke-width="1" opacity="0.18" stroke-dasharray="2 3" />
						<line x1="${xx.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${xx.toFixed(2)}" y2="${(y0 + 4).toFixed(2)}" stroke="${axisColor}" stroke-width="1" />
						<text x="${xx.toFixed(2)}" y="${(y0 + 16).toFixed(2)}" text-anchor="middle" fill="${tickColor}" font-size="${fontSize}">${p.label}</text>
					</g>
				`;
      })
      .join('');

    scale = { minT, maxT, w, h, margin, innerW, innerH };
    const yAxisBottom = margin.top + innerH;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const cursorX = (ms) => {
      const t = clamp(Number(ms), minT, maxT);
      const span = Math.max(1, maxT - minT);
      return margin.left + ((t - minT) / span) * innerW;
    };

    const cursorInitialMs = Number.isFinite(pendingCursorMs) ? pendingCursorMs : points[0].t;
    const cx = cursorX(cursorInitialMs);
    const cursorLabel = formatTimeHmJst(cursorInitialMs);
    const cursorLabelY = 1;
    const cursorLineTop = margin.top + 6;

    // タイトル（港名のみ表示）
    if (statusEl) statusEl.textContent = String(portName ?? '').trim();

    // area fill
    const yBase = margin.top + innerH;
    const areaD = (() => {
      const first = points[0];
      const last = points[points.length - 1];
      const parts = [];
      parts.push(`M ${x(first.t).toFixed(2)} ${yBase.toFixed(2)}`);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        parts.push(`L ${x(p.t).toFixed(2)} ${y(p.cm).toFixed(2)}`);
      }
      parts.push(`L ${x(last.t).toFixed(2)} ${yBase.toFixed(2)}`);
      parts.push('Z');
      return parts.join(' ');
    })();

    svgWrap.innerHTML = `
			<svg class="gpxv-tide__svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="潮汐グラフ">
				<defs>
					<linearGradient id="gpxv-tide-area" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="${accent}" stop-opacity="0.26" />
						<stop offset="100%" stop-color="${accent}" stop-opacity="0.00" />
					</linearGradient>
					<clipPath id="gpxv-tide-clip">
						<rect x="${margin.left.toFixed(2)}" y="${margin.top.toFixed(2)}" width="${innerW.toFixed(2)}" height="${innerH.toFixed(2)}" rx="6" ry="6" />
					</clipPath>
				</defs>
				<!-- chart frame -->
				<rect x="${(margin.left - 6).toFixed(2)}" y="${(margin.top - 4).toFixed(2)}" width="${(innerW + 12).toFixed(2)}" height="${(innerH + 10).toFixed(2)}" rx="8" ry="8" fill="rgba(255,255,255,0.55)" stroke="rgba(0,0,0,0.10)" />
				<!-- y ticks/grid -->
				${yTickEls}
				<!-- axes -->
				<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(margin.top + innerH).toFixed(2)}" stroke="${axisColor}" stroke-width="1" />
				<line x1="${margin.left}" y1="${(margin.top + innerH).toFixed(2)}" x2="${(margin.left + innerW).toFixed(2)}" y2="${(margin.top + innerH).toFixed(2)}" stroke="${axisColor}" stroke-width="1" />
				<!-- x ticks -->
				${xTickEls}
				<!-- area + line (clipped) -->
				<g clip-path="url(#gpxv-tide-clip)">
					<path d="${areaD}" fill="url(#gpxv-tide-area)" stroke="none" />
					<path d="${d}" fill="none" stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
				</g>
				<!-- cursor -->
				<line id="gpxv-tide-cursor-line" x1="${cx.toFixed(2)}" y1="${cursorLineTop.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${yAxisBottom.toFixed(2)}" stroke="rgba(0,0,0,0.45)" stroke-width="1" stroke-dasharray="3 3" />
				<text id="gpxv-tide-cursor-text" x="${cx.toFixed(2)}" y="${cursorLabelY.toFixed(2)}" text-anchor="middle" dominant-baseline="hanging" fill="rgba(0,0,0,0.80)" font-size="10">${cursorLabel}</text>
			</svg>
		`;

    // (debug duplicate removed)

    try {
      syncDisplaySize();
    } catch {
      // ignore
    }

    cursorLineEl = svgWrap.querySelector('#gpxv-tide-cursor-line');
    cursorTextEl = svgWrap.querySelector('#gpxv-tide-cursor-text');
    if (Number.isFinite(pendingCursorMs)) {
      setCursorTime(pendingCursorMs);
    }
  };

  const setCursorTime = (ms) => {
    pendingCursorMs = Number(ms);
    if (!scale || !cursorLineEl || !cursorTextEl) return;
    const { minT, maxT, margin, innerW } = scale;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const t = clamp(Number(ms), minT, maxT);
    const span = Math.max(1, maxT - minT);
    const cx = margin.left + ((t - minT) / span) * innerW;
    cursorLineEl.setAttribute('x1', cx.toFixed(2));
    cursorLineEl.setAttribute('x2', cx.toFixed(2));
    cursorTextEl.setAttribute('x', cx.toFixed(2));
    cursorTextEl.textContent = formatTimeHmJst(t);
  };

  const loadAndRender = async ({ ymd, pc, hc, rg }) => {
    const reqId = ++lastRequestId;
    // 失敗時は表示しない要件のため、ロード中も一旦は非表示のまま
    hide();
    try { setLoading('読込中...'); } catch {}
    try {
      const data = await fetchTide736Day({ ymd, pc, hc, rg });
      if (reqId !== lastRequestId) return;
      // fetched
      render(data);
    } catch (err) {
      if (reqId !== lastRequestId) return;
      console.error('潮汐の取得に失敗しました:', err);
      try { setMessage('潮汐データの取得に失敗しました'); } catch {}
      // no sidebar duplicate to update
      // 失敗時は表示しない（地図上のコントロールは非表示）
      hide();
    }
  };

  return {
    setMessage,
    renderData: (data) => {
      try {
        render(data);
      } catch {
        // ignore
      }
    },
    loadAndRender,
    show,
    hide,
    setCursorTime,
    remove: () => {
      try {
        control.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 地図上に「現在速度（前後30秒平均）」を表示するHUD。
 * @param {any} map
 * @param {{ position?: string }} opts
 */
function createSpeedHudControl(map, opts = {}) {
  const pos = typeof opts.position === 'string' ? opts.position : 'topleft';
  const control = L.control({ position: pos });
  let container = null;
  let valueEl = null;
  let isAdded = false;

  control.onAdd = () => {
    container = L.DomUtil.create('div', 'gpxv-speedhud');
    container.setAttribute('aria-label', '現在速度');
    container.innerHTML = `
			<div class="gpxv-speedhud__k">速度（前後30秒平均）</div>
			<div class="gpxv-speedhud__v" data-k="spd">-</div>
		`;
    valueEl = container.querySelector('[data-k="spd"]');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };

  const show = () => {
    if (isAdded) return;
    try {
      control.addTo(map);
      isAdded = true;
    } catch {
      // ignore
    }
  };

  const hide = () => {
    if (!isAdded) return;
    try {
      control.remove();
    } catch {
      // ignore
    }
    isAdded = false;
  };

  return {
    setSpeedKnots: (knots) => {
      if (!valueEl) return;
      if (!Number.isFinite(knots) || knots < 0) {
        valueEl.textContent = '-';
        return;
      }
      valueEl.textContent = `${knots.toFixed(2)} kn`;
    },
    setVisible: (visible) => {
      if (visible) show();
      else hide();
    },
    remove: () => {
      try {
        control.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 地図上に主要数値を表示する「スタンプ」オーバーレイ（画像保存にも写り込む）。
 * @param {any} map
 * @param {{ position?: string }} opts
 */
function createMapStampControl(map, opts = {}) {
  const pos = typeof opts.position === 'string' ? opts.position : 'topleft';
  const control = L.control({ position: pos });
  let container = null;
  let rows = null;

  control.onAdd = () => {
    container = L.DomUtil.create('div', 'gpxv-mapstamp');
    container.setAttribute('aria-label', '画像用スタンプ');
    container.innerHTML = `
			<div class="gpxv-mapstamp__title">GPX</div>
			<div class="gpxv-mapstamp__row"><span class="gpxv-mapstamp__k">日時</span><span class="gpxv-mapstamp__v" data-k="dt">-</span></div>
			<div class="gpxv-mapstamp__row"><span class="gpxv-mapstamp__k">距離</span><span class="gpxv-mapstamp__v" data-k="dist">-</span></div>
			<div class="gpxv-mapstamp__row"><span class="gpxv-mapstamp__k">平均</span><span class="gpxv-mapstamp__v" data-k="spd">-</span></div>
		`;
    rows = {
      dt: container.querySelector('[data-k="dt"]'),
      dist: container.querySelector('[data-k="dist"]'),
      spd: container.querySelector('[data-k="spd"]'),
    };
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };

  control.addTo(map);

  const setVisible = (visible) => {
    if (!container) return;
    container.style.display = visible ? '' : 'none';
  };

  const setData = ({ date, time, distanceText, speedText }) => {
    if (!rows) return;
    if (rows.dt) rows.dt.textContent = date && time ? `${date} ${time}` : '-';
    if (rows.dist) rows.dist.textContent = distanceText ?? '-';
    if (rows.spd) rows.spd.textContent = speedText ?? '-';
  };

  return {
    setVisible,
    setData,
    remove: () => {
      try {
        control.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 潮汐表示のトグルボタン（サイドバー）
 * @param {HTMLElement} host
 * @param {{ getEnabled: () => boolean, onToggle: (enabled: boolean) => void }} opts
 */
function createTideToggleControl(host, opts) {
  const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--tide-toggle', host);
  const title = L.DomUtil.create('div', 'gpxv-control__title', container);
  title.textContent = '潮汐';
  const row = L.DomUtil.create('div', 'gpxv-row', container);
  const btn = L.DomUtil.create('button', 'gpxv-btn', row);
  btn.type = 'button';
  btn.textContent = '表示';
  btn.setAttribute('aria-pressed', 'false');

  const syncUi = () => {
    const enabled = Boolean(opts?.getEnabled?.());
    btn.setAttribute('aria-pressed', String(enabled));
    btn.textContent = enabled ? '非表示' : '表示';
  };

  const toggle = () => {
    const next = !Boolean(opts?.getEnabled?.());
    try {
      opts?.onToggle?.(next);
    } catch {
      // ignore
    }
    syncUi();
  };

  syncUi();
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    sync: () => {
      try {
        syncUi();
      } catch {
        // ignore
      }
    },
    setVisible: (visible) => {
      try {
        container.style.display = visible ? '' : 'none';
      } catch {
        // ignore
      }
    },
    remove: () => {
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 速度HUDの表示/非表示トグルボタン（サイドバー）
 * @param {HTMLElement} host
 * @param {{ getEnabled: () => boolean, onToggle: (enabled: boolean) => void }} opts
 */
function createSpeedHudToggleControl(host, opts) {
  const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--speedhud-toggle', host);
  const title = L.DomUtil.create('div', 'gpxv-control__title', container);
  title.textContent = '速度HUD';
  const row = L.DomUtil.create('div', 'gpxv-row', container);
  const btn = L.DomUtil.create('button', 'gpxv-btn', row);
  btn.type = 'button';
  btn.textContent = '表示';
  btn.setAttribute('aria-pressed', 'false');

  const syncUi = () => {
    const enabled = Boolean(opts?.getEnabled?.());
    btn.setAttribute('aria-pressed', String(enabled));
    btn.textContent = enabled ? '非表示' : '表示';
  };

  const toggle = () => {
    const next = !Boolean(opts?.getEnabled?.());
    try {
      opts?.onToggle?.(next);
    } catch {
      // ignore
    }
    syncUi();
  };

  syncUi();
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    sync: () => {
      try {
        syncUi();
      } catch {
        // ignore
      }
    },
    setVisible: (visible) => {
      try {
        container.style.display = visible ? '' : 'none';
      } catch {
        // ignore
      }
    },
    remove: () => {
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 画像を追加せず、CSSで見た目を整えたマーカーアイコン
 */
function createCuteMarkerIcon() {
  return L.divIcon({
    className: 'gpxv-marker',
    html: '<div class="gpxv-marker__dot"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/**
 * @param {string} gpxUrl
 * @returns {Promise<{ latlngs: Array<[number, number]>, timesMs: number[] }>}
 */
async function loadGpxTrack(gpxUrl) {
  const res = await fetch(gpxUrl);
  if (!res.ok) {
    throw new Error(`GPXの取得に失敗しました: ${gpxUrl} (${res.status} ${res.statusText})`);
  }

  const gpxText = await res.text();
  return parseGpxText(gpxText, gpxUrl);
}

/**
 * @param {string} gpxText
 * @param {string} sourceLabel
 * @returns {{ latlngs: Array<[number, number]>, timesMs: number[] }}
 */
function parseGpxText(gpxText, sourceLabel = '') {
  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, 'application/xml');

  const parseError = xml.querySelector('parsererror');
  if (parseError) {
    throw new Error(`GPXのXML解析に失敗しました: ${sourceLabel}`);
  }

  // track points(trkpt) と route points(rtept) の両方に対応
  const points = xml.querySelectorAll('trkpt, rtept');
  const latlngs = [];
  const timesMs = [];

  for (const pt of points) {
    const latStr = pt.getAttribute('lat');
    const lonStr = pt.getAttribute('lon');
    if (latStr == null || lonStr == null) continue;

    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    latlngs.push([lat, lon]);

    const timeEl = pt.getElementsByTagName('time')?.[0] ?? null;
    const t = timeEl?.textContent?.trim();
    if (t) {
      const ms = Date.parse(t);
      timesMs.push(Number.isFinite(ms) ? ms : NaN);
    } else {
      timesMs.push(NaN);
    }
  }

  // timeが全部NaNなら「timeなし」とみなす
  const hasAnyTime = timesMs.some((v) => Number.isFinite(v));
  return { latlngs, timesMs: hasAnyTime ? timesMs : [] };
}

/**
 * GPXアップロード用UI（地図とは分離して表示）
 * @param {HTMLElement} host
 * @param {(payload: {name: string, text: string}) => void | Promise<void>} onLoaded
 * @param {() => void | Promise<void>} onDemo
 */
function createGpxUploadControl(host, onLoaded, onDemo) {
  const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--upload', host);

  const title = L.DomUtil.create('div', 'gpxv-control__title', container);
  title.textContent = 'GPX';

  const btnRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mb6', container);

  const demoBtn = L.DomUtil.create('button', 'gpxv-btn', btnRow);
  demoBtn.type = 'button';
  demoBtn.textContent = 'デモ';

  const fileInput = L.DomUtil.create('input', 'gpxv-file', btnRow);
  fileInput.type = 'file';
  fileInput.accept = '.gpx,application/gpx+xml,application/xml,text/xml';

  const status = L.DomUtil.create('div', 'gpxv-status', container);
  status.textContent = '未選択';

  const setBusy = (busy) => {
    const isBusy = Boolean(busy);
    fileInput.disabled = isBusy;
    demoBtn.disabled = isBusy;
    container.classList.toggle('gpxv-is-busy', isBusy);
  };

  demoBtn.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onDemo) return;
    setBusy(true);
    status.textContent = '読込中: デモ';
    try {
      await onDemo();
      status.textContent = '表示中: デモ';
    } catch (err) {
      console.error(err);
      status.textContent = '失敗: デモ';
    } finally {
      setBusy(false);
    }
  });
  demoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0] ?? null;
    if (!file) return;
    setBusy(true);
    status.textContent = `読込中: ${file.name}`;
    try {
      const text = await file.text();
      await onLoaded({ name: file.name, text });
      status.textContent = `表示中: ${file.name}`;
    } catch (e) {
      console.error(e);
      status.textContent = `失敗: ${file.name}`;
    } finally {
      setBusy(false);
    }
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    remove: () => {
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
  };
}

function buildExportFilename(filenameHint) {
  const hint = String(filenameHint || '').trim();
  const baseHint = sanitizeFilename(hint).slice(0, 40);
  const stamp = formatStampYmdHmsJst(Date.now());
  return baseHint ? `gpx_${baseHint}_${stamp}.png` : `gpx_${stamp}.png`;
}

function sleep(ms) {
  const t = Number(ms);
  return new Promise((resolve) => setTimeout(resolve, Number.isFinite(t) ? t : 0));
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function settleLeafletForCapture(map) {
  if (!map) {
    await nextAnimationFrame();
    return;
  }

  // 現在の center/zoom を再適用して、pane の transform を確定させる
  const center = map.getCenter?.();
  const zoom = map.getZoom?.();
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        map.off?.('moveend', finish);
        map.off?.('zoomend', finish);
      } catch {
        // ignore
      }
      resolve();
    };
    try {
      map.once?.('moveend', finish);
      map.once?.('zoomend', finish);
    } catch {
      // ignore
    }
    try {
      map.setView?.(center, zoom, { animate: false });
    } catch {
      // ignore
    }
    setTimeout(finish, 220);
  });

  await nextAnimationFrame();
  await sleep(80);
}

function sanitizeFilename(name) {
  const s = String(name || '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'track';
}

function formatStampYmdHmsJst(ms) {
  const parts = getJstParts(ms);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${parts.year}${pad2(parts.month)}${pad2(parts.day)}_${pad2(parts.hour)}${pad2(parts.minute)}${pad2(parts.second)}`;
}

async function downloadElementAsPng(el, filename) {
  const html2canvasFn = globalThis?.html2canvas;
  if (typeof html2canvasFn !== 'function') {
    throw new Error('html2canvas が読み込まれていません。index.html に script タグを追加してください。');
  }

  // 右パネルは地図領域に重なる可能性があるため、出力中だけ隠す
  const sidebarEl = document.getElementById('sidebar');
  const prevSidebarVisibility = sidebarEl?.style?.visibility;
  try {
    if (sidebarEl) sidebarEl.style.visibility = 'hidden';
  } catch {
    // ignore
  }

  // Leaflet は内部で transform を多用するため、要素直指定だと環境によって座標がズレることがある。
  // そこで「ドキュメント全体を描画」→「対象要素の矩形で切り出し」でズレを抑える。
  try {
    const rect = el.getBoundingClientRect();
    const x = rect.left + (window.scrollX || 0);
    const y = rect.top + (window.scrollY || 0);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    // CORS対応（OSMタイル等）
    const canvas = await html2canvasFn(document.documentElement, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      x,
      y,
      width,
      height,
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      scale: Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1)),
    });

    const blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
    if (!blob) throw new Error('PNGの生成に失敗しました');

    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = String(filename || 'gpx.png');
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  } finally {
    try {
      if (sidebarEl) sidebarEl.style.visibility = prevSidebarVisibility ?? '';
    } catch {
      // ignore
    }
  }
}

/**
 * YouTubeショート向けに「地図表示部分」を 1080x1920 に固定するトグル
 * @param {HTMLElement} host
 * @param {{ map: any }} ctx
 */
function createVideoSizeControl(host, ctx, opts = {}) {
  const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--video', host);

  const title = L.DomUtil.create('div', 'gpxv-control__title', container);
  title.textContent = '画面サイズ';

  const row = L.DomUtil.create('div', 'gpxv-row', container);
  const right = L.DomUtil.create('div', 'gpxv-right', row);

  const btn = L.DomUtil.create('button', 'gpxv-btn', right);
  btn.type = 'button';
  btn.textContent = '9:16';
  btn.setAttribute('aria-pressed', 'false');

  const onExport = typeof opts.onExport === 'function' ? opts.onExport : null;
  const onShortsChanged = typeof opts.onShortsChanged === 'function' ? opts.onShortsChanged : null;
  const exportBtn = L.DomUtil.create('button', 'gpxv-btn gpxv-btn--play', right);
  exportBtn.type = 'button';
  exportBtn.textContent = '画像保存';

  const CLASS_NAME = 'gpxv-shorts';
  const isEnabled = () => document.body.classList.contains(CLASS_NAME);
  const syncShortsMapSize = () => {
    if (!isEnabled()) return;
    const isNarrow = (() => {
      try {
        return window?.matchMedia?.('(max-width: 768px)')?.matches ?? false;
      } catch {
        return false;
      }
    })();

    const sidebarEl = document.getElementById('sidebar');
    const sidebarWidth = isNarrow ? 0 : Math.max(0, sidebarEl?.getBoundingClientRect?.().width ?? 0);
    const viewportW = Math.max(0, window.innerWidth || 0);
    const viewportH = Math.max(0, window.innerHeight || 0);

    // 右パネル分を除いた領域で 9:16 を維持しつつ最大化（上限は1080x1920）
    const availableW = Math.max(1, viewportW - sidebarWidth);
    const availableH = Math.max(1, viewportH);

    const MAX_W = 1080;
    const MAX_H = 1920;

    let w = Math.min(MAX_W, availableW);
    let h = (w * 16) / 9;
    if (h > availableH) {
      h = Math.min(MAX_H, availableH);
      w = (h * 9) / 16;
    }
    // 念のため上限を再適用
    w = Math.min(MAX_W, w);
    h = Math.min(MAX_H, h);

    const root = document.documentElement;
    root.style.setProperty('--gpxv-shorts-map-w', `${Math.round(w)}px`);
    root.style.setProperty('--gpxv-shorts-map-h', `${Math.round(h)}px`);
  };
  const clearShortsMapSize = () => {
    const root = document.documentElement;
    root.style.removeProperty('--gpxv-shorts-map-w');
    root.style.removeProperty('--gpxv-shorts-map-h');
  };
  const invalidateMapSizeSoon = () => {
    requestAnimationFrame(() => {
      try {
        ctx?.map?.invalidateSize?.();
      } catch {
        // ignore
      }
    });
  };

  const setEnabled = (enabled) => {
    const next = Boolean(enabled);
    document.body.classList.toggle(CLASS_NAME, next);
    btn.setAttribute('aria-pressed', String(next));
    if (next) syncShortsMapSize();
    else clearShortsMapSize();
    try {
      onShortsChanged?.(next);
    } catch {
      // ignore
    }
    invalidateMapSizeSoon();
  };

  const handleResize = () => {
    if (!isEnabled()) return;
    syncShortsMapSize();
    invalidateMapSizeSoon();
  };
  window.addEventListener('resize', handleResize, { passive: true });

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEnabled(!isEnabled());
  });
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  exportBtn.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onExport) return;
    const prev = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = '出力中...';
    try {
      await onExport();
    } catch (err) {
      console.error(err);
    } finally {
      exportBtn.textContent = prev;
      exportBtn.disabled = false;
    }
  });
  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);
  return {
    remove: () => {
      try {
        window.removeEventListener('resize', handleResize);
      } catch {
        // ignore
      }
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 時間軸スライダをUI枠に表示し、マーカーを移動させる（地図とは分離）
 * @param {any} map
 * @param {HTMLElement} host
 * @param {{ latlngs: Array<[number, number]>, timesMs: number[], marker: any }} track
 */
function createTimeSliderControl(map, host, track, opts = {}) {
  const timeIndex = buildTimeIndex(track.timesMs);
  if (!timeIndex.times.length) return null;
  const onStats = typeof opts.onStats === 'function' ? opts.onStats : null;
  const onTime = typeof opts.onTime === 'function' ? opts.onTime : null;
  let recentWindowMs = Number.isFinite(opts.recentWindowMs) && opts.recentWindowMs > 0 ? opts.recentWindowMs : 7 * 60 * 1000;

  const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--time', host);

  // 日付と時刻（横並び）
  const dateTimeRow = L.DomUtil.create('div', 'gpxv-datetime', container);
  const dateLabel = L.DomUtil.create('div', 'gpxv-label', dateTimeRow);
  const timeLabel = L.DomUtil.create('div', 'gpxv-label', dateTimeRow);

  const sliderMin = timeIndex.times[0];
  const sliderMax = timeIndex.times[timeIndex.times.length - 1];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const findFirstIndexGE = (arr, value) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const findLastIndexLE = (arr, value) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };
  const getSnappedTime = (ms) => {
    const idxSorted = findClosestIndex(timeIndex.times, ms);
    return timeIndex.times[idxSorted];
  };

  // レール左右の内側余白（端に寄るとラベルが潰れるのを防ぐ）
  const railInsetPx = 18;
  const pctToPx = (pct) => {
    const safePct = clamp(pct, 0, 100) / 100;
    const usable = Math.max(0, rangeWrap.clientWidth - railInsetPx * 2);
    return railInsetPx + usable * safePct;
  };

  // 区間選択スライダ（開始/終了） + 現在位置マーカー
  const rangeWrap = L.DomUtil.create('div', 'gpxv-range', container);

  // 選択範囲の塗り（開始〜終了）
  const rangeFill = L.DomUtil.create('div', 'gpxv-range__fill', rangeWrap);

  const rangeActive = L.DomUtil.create('div', 'gpxv-range__active', rangeFill);

  const startLabel = L.DomUtil.create('div', 'gpxv-range__label', rangeWrap);
  startLabel.textContent = '開始';

  const startGuide = L.DomUtil.create('div', 'gpxv-range__guide', rangeWrap);

  const endLabel = L.DomUtil.create('div', 'gpxv-range__label', rangeWrap);
  endLabel.textContent = '終了';

  const endGuide = L.DomUtil.create('div', 'gpxv-range__guide', rangeWrap);

  let rangeStartMs = sliderMin;
  let rangeEndMs = sliderMax;
  let currentMs = sliderMin;
  let playbackEstimateValueEl = null;

  const createHandle = (ariaLabel, className) => {
    const handle = L.DomUtil.create('div', `gpxv-range__handle ${className}`, rangeWrap);
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', ariaLabel);
    return handle;
  };

  // 初期状態で現在位置マーカーと重なっても開始を掴めるように、開始/終了を前面にする
  const startHandle = createHandle('開始位置', 'gpxv-range__handle--start');
  const endHandle = createHandle('終了位置', 'gpxv-range__handle--end');

  const currentHandle = L.DomUtil.create('div', 'gpxv-range__handle gpxv-range__handle--current', rangeWrap);
  currentHandle.setAttribute('role', 'slider');
  currentHandle.setAttribute('aria-label', '現在位置');

  // 選択範囲の軌跡（開始〜終了）：ベースより「濃く・太く」して範囲外と区別
  let rangeOpacity = 0.42;
  let rangeWeight = 5;
  // 現在地から過去一定時間：さらに強調
  let recentOpacity = 0.7;
  let recentWeight = 12;

  const rangeLayer = L.polyline([], {
    color: '#0078A8',
    weight: rangeWeight,
    opacity: rangeOpacity,
  }).addTo(map);
  // 現在地から過去一定時間の軌跡（濃い色・太め）
  const recentLayer = L.polyline([], {
    color: '#0078A8',
    weight: recentWeight,
    opacity: recentOpacity,
  }).addTo(map);
  rangeLayer.bringToFront();
  recentLayer.bringToFront();

  // 目盛り（区間選択の下に表示）
  const ticksRow = L.DomUtil.create('div', 'gpxv-ticks', container);

  const tickTimes = buildUniformTickTimes(sliderMin, sliderMax, 6);
  for (const t of tickTimes) {
    const tick = L.DomUtil.create('div', 'gpxv-tick', ticksRow);

    L.DomUtil.create('div', 'gpxv-tick__bar', tick);

    const label = L.DomUtil.create('div', 'gpxv-tick__label', tick);
    label.textContent = formatTickTimeJst(t);
  }

  // 開始/終了の時刻入力（微調整用）
  const rangeEditTitle = L.DomUtil.create('div', 'gpxv-range-title', container);
  rangeEditTitle.textContent = '開始/終了の時刻';

  const startTimeRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const startTimeLabel = L.DomUtil.create('div', 'gpxv-speed-label', startTimeRow);
  startTimeLabel.textContent = '開始';
  const startTimeInput = L.DomUtil.create('input', 'gpxv-input', startTimeRow);
  startTimeInput.type = 'datetime-local';
  startTimeInput.step = '1';

  const endTimeRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const endTimeLabel = L.DomUtil.create('div', 'gpxv-speed-label', endTimeRow);
  endTimeLabel.textContent = '終了';
  const endTimeInput = L.DomUtil.create('input', 'gpxv-input', endTimeRow);
  endTimeInput.type = 'datetime-local';
  endTimeInput.step = '1';

  const normalizeRange = () => {
    let a = Number(rangeStartMs);
    let b = Number(rangeEndMs);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      a = sliderMin;
      b = sliderMax;
    }
    a = clamp(a, sliderMin, sliderMax);
    b = clamp(b, sliderMin, sliderMax);
    if (a <= b) {
      rangeStartMs = a;
      rangeEndMs = b;
    } else {
      rangeStartMs = b;
      rangeEndMs = a;
    }
  };

  const clampCurrent = () => {
    normalizeRange();
    let c = Number(currentMs);
    if (!Number.isFinite(c)) c = rangeStartMs;
    currentMs = clamp(c, rangeStartMs, rangeEndMs);
  };

  const updateCurrentUI = () => {
    clampCurrent();
    const span = sliderMax - sliderMin;
    const pct = span > 0 ? ((currentMs - sliderMin) / span) * 100 : 0;
    currentHandle.style.left = `${pctToPx(pct)}px`;
  };

  const syncRangeInputs = () => {
    normalizeRange();
    // 入力中は上書きしない（タイピングが途切れないように）
    if (document.activeElement !== startTimeInput) {
      startTimeInput.value = formatDateTimeLocalValueJst(rangeStartMs);
    }
    if (document.activeElement !== endTimeInput) {
      endTimeInput.value = formatDateTimeLocalValueJst(rangeEndMs);
    }
  };

  const updateRangeUI = () => {
    normalizeRange();
    const beforeCurrent = currentMs;
    clampCurrent();
    syncAutoPlaybackSpeed();
    updatePlaybackEstimateUI();
    const span = sliderMax - sliderMin;
    const startPct = span > 0 ? ((rangeStartMs - sliderMin) / span) * 100 : 0;
    const endPct = span > 0 ? ((rangeEndMs - sliderMin) / span) * 100 : 100;
    rangeActive.style.left = `${clamp(startPct, 0, 100)}%`;
    rangeActive.style.width = `${clamp(endPct - startPct, 0, 100)}%`;
    startLabel.style.left = `${pctToPx(startPct)}px`;
    endLabel.style.left = `${pctToPx(endPct)}px`;
    startGuide.style.left = `${pctToPx(startPct)}px`;
    endGuide.style.left = `${pctToPx(endPct)}px`;
    startHandle.style.left = `${pctToPx(startPct)}px`;
    endHandle.style.left = `${pctToPx(endPct)}px`;
    updateCurrentUI();
    if (currentMs !== beforeCurrent) update(currentMs);
    syncRangeInputs();

    // 範囲内の軌跡を抽出して薄い線で表示
    const pts = [];
    const llRangeStart = getLatLngAtTime(rangeStartMs);
    if (llRangeStart) pts.push(llRangeStart);
    for (let i = 0; i < track.timesMs.length; i++) {
      const t = track.timesMs[i];
      if (!Number.isFinite(t)) continue;
      if (t < rangeStartMs || t > rangeEndMs) continue;
      const ll = track.latlngs[i];
      if (!ll) continue;
      pts.push(ll);
    }
    const llRangeEnd = getLatLngAtTime(rangeEndMs);
    if (llRangeEnd) pts.push(llRangeEnd);
    rangeLayer.setLatLngs(pts);
    rangeLayer.bringToFront();

    // 現在地から過去一定時間の軌跡を濃い線で表示
    const recentStartMs = Math.max(rangeStartMs, Number(currentMs) - recentWindowMs);
    const ptsRecent = [];
    const llRecentStart = getLatLngAtTime(recentStartMs);
    if (llRecentStart) ptsRecent.push(llRecentStart);
    for (let i = 0; i < track.timesMs.length; i++) {
      const t = track.timesMs[i];
      if (!Number.isFinite(t)) continue;
      if (t < recentStartMs || t > currentMs) continue;
      const ll = track.latlngs[i];
      if (!ll) continue;
      ptsRecent.push(ll);
    }
    const llNow = getLatLngAtTime(currentMs);
    if (llNow) ptsRecent.push(llNow);
    recentLayer.setLatLngs(ptsRecent);
    recentLayer.bringToFront();

    if (onStats) {
      const distanceMeters = computePathDistanceMeters(pts);
      const durationMs = Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) ? Math.max(0, rangeEndMs - rangeStartMs) : null;
      const avgSpeedKnots = computeAvgSpeedKnots(distanceMeters, durationMs);
      const latlng = getLatLngAtTime(currentMs);
      onStats({ distanceMeters, durationMs, avgSpeedKnots, latlng });
    }
  };

  const setRangeFromInput = (which) => {
    stop();
    const raw = which === 'start' ? startTimeInput.value : endTimeInput.value;
    const parsedMs = parseDateTimeLocalValueJst(raw);
    if (!Number.isFinite(parsedMs)) {
      syncRangeInputs();
      return;
    }
    const safe = clamp(parsedMs, sliderMin, sliderMax);
    const snapped = getSnappedTime(safe);
    if (which === 'start') {
      rangeStartMs = Math.min(snapped, rangeEndMs);
    } else {
      rangeEndMs = Math.max(snapped, rangeStartMs);
    }
    updateRangeUI();
    syncRangeInputs();
  };

  startTimeInput.addEventListener('change', () => setRangeFromInput('start'));
  endTimeInput.addEventListener('change', () => setRangeFromInput('end'));
  for (const el of [startTimeInput, endTimeInput]) {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      setRangeFromInput(el === startTimeInput ? 'start' : 'end');
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  const getLatLngAtTime = (ms) => {
    const times = timeIndex.times;
    const idxMap = timeIndex.indices;
    if (!times.length) return null;
    const t = clamp(ms, times[0], times[times.length - 1]);
    if (t <= times[0]) return track.latlngs[idxMap[0]] ?? null;
    if (t >= times[times.length - 1]) return track.latlngs[idxMap[idxMap.length - 1]] ?? null;

    let lo = 0;
    let hi = times.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }

    const t0 = times[lo];
    const t1 = times[hi];
    const p0 = track.latlngs[idxMap[lo]];
    const p1 = track.latlngs[idxMap[hi]];
    if (!p0 || !p1) return p0 ?? p1 ?? null;
    const denom = t1 - t0;
    if (!Number.isFinite(denom) || denom <= 0) return p0;
    const r = clamp((t - t0) / denom, 0, 1);
    const lat = p0[0] + (p1[0] - p0[0]) * r;
    const lon = p0[1] + (p1[1] - p0[1]) * r;
    return [lat, lon];
  };

  const update = (ms) => {
    const playheadMs = Number(ms);
    const safeMs = clamp(playheadMs, sliderMin, sliderMax);
    const latlng = getLatLngAtTime(safeMs);
    if (!latlng) return;
    track.marker.setLatLng(latlng);
    dateLabel.textContent = formatDateJst(playheadMs);
    timeLabel.textContent = formatTimeJst(playheadMs);
    if (onTime) {
      try {
        onTime(safeMs);
      } catch {
        // ignore
      }
    }

    updateRecentTrailAt(playheadMs, recentWindowMs);
    if (onStats) {
      const pts = [];
      for (let i = 0; i < track.timesMs.length; i++) {
        const t = track.timesMs[i];
        if (!Number.isFinite(t)) continue;
        if (t < rangeStartMs || t > rangeEndMs) continue;
        const ll = track.latlngs[i];
        if (!ll) continue;
        pts.push(ll);
      }
      const distanceMeters = computePathDistanceMeters(pts);
      const durationMs = Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) ? Math.max(0, rangeEndMs - rangeStartMs) : null;
      const avgSpeedKnots = computeAvgSpeedKnots(distanceMeters, durationMs);
      onStats({ distanceMeters, durationMs, avgSpeedKnots, latlng });
    }
  };

  const updateRecentTrailAt = (endMs, windowMs) => {
    const endLimit = clamp(endMs, sliderMin, sliderMax);
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      recentLayer.setLatLngs([]);
      recentLayer.bringToFront();
      return;
    }
    const recentStartMs = Math.max(rangeStartMs, endMs - windowMs);
    if (!Number.isFinite(recentStartMs) || recentStartMs >= endLimit) {
      recentLayer.setLatLngs([]);
      recentLayer.bringToFront();
      return;
    }
    const ptsRecent = [];
    const llRecentStart = getLatLngAtTime(recentStartMs);
    if (llRecentStart) ptsRecent.push(llRecentStart);
    for (let i = 0; i < track.timesMs.length; i++) {
      const t = track.timesMs[i];
      if (!Number.isFinite(t)) continue;
      if (t < recentStartMs || t > endLimit) continue;
      const ll = track.latlngs[i];
      if (!ll) continue;
      ptsRecent.push(ll);
    }
    const llEnd = getLatLngAtTime(endLimit);
    if (llEnd) ptsRecent.push(llEnd);
    recentLayer.setLatLngs(ptsRecent);
    recentLayer.bringToFront();
  };

  const syncCurrent = (ms) => {
    normalizeRange();
    let c = Number(ms);
    if (!Number.isFinite(c)) c = rangeStartMs;
    const nextCurrent = clamp(c, rangeStartMs, rangeEndMs);
    // 終点以外に移動したら、ホイールによる「尾の消化」はリセット
    if (nextCurrent !== rangeEndMs) wheelTailMs = 0;
    currentMs = nextCurrent;
    update(currentMs);
    updateCurrentUI();
  };

  let activeDrag = null;

  const setFromClientX = (clientX, which) => {
    const rect = rangeFill.getBoundingClientRect();
    const span = sliderMax - sliderMin;
    if (!Number.isFinite(span) || span <= 0 || rect.width <= 0) return;

    const x = clamp(clientX - rect.left, 0, rect.width);
    const pct = x / rect.width;
    const rawMs = sliderMin + pct * span;
    const snapped = getSnappedTime(rawMs);

    if (which === 'start') {
      rangeStartMs = Math.min(snapped, rangeEndMs);
      updateRangeUI();
      return;
    }
    if (which === 'end') {
      rangeEndMs = Math.max(snapped, rangeStartMs);
      updateRangeUI();
      return;
    }
    // current
    syncCurrent(rawMs);
  };

  const onRangePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stop();
    e.preventDefault();
    e.stopPropagation();

    const rect = rangeFill.getBoundingClientRect();
    const span = sliderMax - sliderMin;
    if (!Number.isFinite(span) || span <= 0 || rect.width <= 0) return;
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const pct = x / rect.width;
    const rawMs = sliderMin + pct * span;
    const snapped = getSnappedTime(rawMs);

    if (e.target === startHandle || e.target === startLabel) activeDrag = 'start';
    else if (e.target === endHandle || e.target === endLabel) activeDrag = 'end';
    else if (e.target === currentHandle) activeDrag = 'current';
    else activeDrag = 'current';

    setFromClientX(e.clientX, activeDrag);
    rangeWrap.setPointerCapture(e.pointerId);
  };

  const onRangePointerMove = (e) => {
    if (!activeDrag) return;
    e.preventDefault();
    setFromClientX(e.clientX, activeDrag);
  };

  const onRangePointerUp = (e) => {
    if (!activeDrag) return;
    e.preventDefault();
    activeDrag = null;
    try {
      rangeWrap.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  rangeWrap.addEventListener('pointerdown', onRangePointerDown);
  rangeWrap.addEventListener('pointermove', onRangePointerMove);
  rangeWrap.addEventListener('pointerup', onRangePointerUp);
  rangeWrap.addEventListener('pointercancel', onRangePointerUp);

  // マウスホイールで現在位置を前後（スライダ上のみ）
  let wheelTailMs = 0;
  const wheelTailStepMs = 10_000;
  const onRangeWheel = (e) => {
    stop();
    e.preventDefault();
    e.stopPropagation();
    normalizeRange();
    clampCurrent();
    const times = timeIndex.times;
    if (!times.length) return;
    const minIdx = clamp(findFirstIndexGE(times, rangeStartMs), 0, times.length - 1);
    const maxIdx = clamp(findLastIndexLE(times, rangeEndMs), 0, times.length - 1);
    if (minIdx > maxIdx) return;
    let idx = findClosestIndex(times, currentMs);
    idx = clamp(idx, minIdx, maxIdx);
    const dir = e.deltaY > 0 ? 1 : -1;
    const steps = Math.max(1, Math.round(Math.abs(e.deltaY) / 80));

    // 終点でさらにホイールを回した場合、内部的に「終点＋軌跡時間」まで進めて移動軌跡を消す
    if (idx === maxIdx && dir > 0) {
      wheelTailMs = clamp(wheelTailMs + steps * wheelTailStepMs, 0, recentWindowMs);
      if (currentMs !== rangeEndMs) syncCurrent(rangeEndMs);
      // 時刻表示は終点のまま、軌跡だけ縮める
      updateRecentTrailAt(rangeEndMs + wheelTailMs, recentWindowMs);
      return;
    }
    if (idx === maxIdx && dir < 0 && wheelTailMs > 0) {
      wheelTailMs = clamp(wheelTailMs - steps * wheelTailStepMs, 0, recentWindowMs);
      updateRecentTrailAt(rangeEndMs + wheelTailMs, recentWindowMs);
      return;
    }

    wheelTailMs = 0;
    const nextIdx = clamp(idx + dir * steps, minIdx, maxIdx);
    syncCurrent(times[nextIdx]);
  };
  rangeWrap.addEventListener('wheel', onRangeWheel, { passive: false });

  // 再生・停止ボタン
  const speedRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);

  const speedLabel = L.DomUtil.create('div', 'gpxv-speed-label', speedRow);
  speedLabel.textContent = '速度';

  const speedSelect = L.DomUtil.create('select', 'gpxv-select', speedRow);

  const speedOptions = [
    { key: 'low', label: '低速', value: 60 },
    { key: 'mid', label: '中速', value: 120 },
    { key: 'high', label: '高速', value: 240 },
    { key: 'ultra', label: '超高速', value: 480 },
  ];

  const AUTO_40_KEY = 'auto40';
  const AUTO_50_KEY = 'auto50';
  const AUTO_SECONDS_BY_KEY = {
    [AUTO_40_KEY]: 40,
    [AUTO_50_KEY]: 50,
  };

  function updatePlaybackEstimateUI() {
    if (!playbackEstimateValueEl) return;
    normalizeRange();
    const durationMs = Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) ? Math.max(0, rangeEndMs - rangeStartMs) : null;
    if (!Number.isFinite(durationMs)) {
      playbackEstimateValueEl.textContent = '-';
      return;
    }

    if (speedMode in AUTO_SECONDS_BY_KEY) {
      const seconds = AUTO_SECONDS_BY_KEY[speedMode];
      playbackEstimateValueEl.textContent = `約${seconds}秒`;
      return;
    }

    const s = Number(playbackSpeed);
    if (!Number.isFinite(s) || s <= 0) {
      playbackEstimateValueEl.textContent = '-';
      return;
    }
    const seconds = Math.max(0, durationMs / (s * 1000));
    playbackEstimateValueEl.textContent = `約${Math.round(seconds)}秒`;
  }

  for (const opt of speedOptions) {
    const o = document.createElement('option');
    o.value = String(opt.value);
    o.textContent = opt.label;
    speedSelect.appendChild(o);
  }
  {
    const o = document.createElement('option');
    o.value = AUTO_40_KEY;
    o.textContent = '全体を40秒で表示';
    speedSelect.appendChild(o);
  }
  {
    const o = document.createElement('option');
    o.value = AUTO_50_KEY;
    o.textContent = '全体を50秒で表示';
    speedSelect.appendChild(o);
  }

  const estimateRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const estimateLabel = L.DomUtil.create('div', 'gpxv-speed-label', estimateRow);
  estimateLabel.textContent = '再生時間';
  playbackEstimateValueEl = L.DomUtil.create('div', 'gpxv-label', estimateRow);
  playbackEstimateValueEl.textContent = '-';

  const btnRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);

  const resetBtn = L.DomUtil.create('button', 'gpxv-btn', btnRow);
  resetBtn.type = 'button';
  resetBtn.textContent = '開始へ戻る';

  const rightBtns = L.DomUtil.create('div', 'gpxv-right', btnRow);

  const playBtn = L.DomUtil.create('button', 'gpxv-btn gpxv-btn--play', rightBtns);
  playBtn.type = 'button';
  playBtn.textContent = '再生';

  let playbackSpeed = 240;
  if (Number.isFinite(track.playbackSpeed)) playbackSpeed = track.playbackSpeed;
  if (!Number.isFinite(playbackSpeed) || playbackSpeed <= 0) playbackSpeed = 240;
  let speedMode = 'fixed';

  const snapSpeed = (v) => {
    let best = speedOptions[0].value;
    let bestDist = Math.abs(v - best);
    for (const opt of speedOptions) {
      const d = Math.abs(v - opt.value);
      if (d < bestDist) {
        bestDist = d;
        best = opt.value;
      }
    }
    return best;
  };

  const computeAutoPlaybackSpeed = () => {
    const seconds = AUTO_SECONDS_BY_KEY[speedMode];
    if (!Number.isFinite(seconds) || seconds <= 0) return playbackSpeed;
    // 選択範囲（開始〜終了）を指定秒で再生できる倍率にする
    const durationMs = Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) ? Math.max(1, rangeEndMs - rangeStartMs) : 1;
    return durationMs / (seconds * 1000);
  };
  const syncAutoPlaybackSpeed = () => {
    if (!(speedMode in AUTO_SECONDS_BY_KEY)) return;
    playbackSpeed = computeAutoPlaybackSpeed();
  };

  playbackSpeed = snapSpeed(playbackSpeed);
  speedSelect.value = String(playbackSpeed);

  speedSelect.addEventListener('change', () => {
    const raw = String(speedSelect.value);
    if (raw in AUTO_SECONDS_BY_KEY) {
      speedMode = raw;
      syncAutoPlaybackSpeed();
      updatePlaybackEstimateUI();
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    speedMode = 'fixed';
    playbackSpeed = v;
    updatePlaybackEstimateUI();
  });

  updatePlaybackEstimateUI();

  let isPlaying = false;
  let rafId = 0;
  let lastNow = 0;
  let playheadMs = currentMs;
  let isTailOut = false;

  const stop = () => {
    if (!isPlaying) return;
    isPlaying = false;
    isTailOut = false;
    playBtn.textContent = '再生';
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  };

  const start = () => {
    if (isPlaying) return;
    normalizeRange();
    clampCurrent();
    // 現在位置→終了まで再生。終点にいる場合は開始へ戻さず、尾の消化（終点+軌跡時間）だけ行う。
    if (!Number.isFinite(currentMs)) {
      syncCurrent(rangeStartMs);
    } else if (currentMs >= rangeEndMs) {
      syncCurrent(rangeEndMs);
    } else {
      syncCurrent(currentMs);
    }
    isPlaying = true;
    isTailOut = Number.isFinite(currentMs) && currentMs >= rangeEndMs;
    playheadMs = isTailOut ? rangeEndMs : currentMs;
    playBtn.textContent = '停止';
    lastNow = performance.now();
    const loop = (now) => {
      if (!isPlaying) return;
      const dt = Math.min(100, now - lastNow);
      lastNow = now;

      if (!isTailOut) {
        const next = playheadMs + dt * playbackSpeed;
        if (next >= rangeEndMs) {
          syncCurrent(rangeEndMs);
          playheadMs = rangeEndMs;
          isTailOut = true;
        } else {
          playheadMs = next;
          syncCurrent(playheadMs);
          rafId = requestAnimationFrame(loop);
          return;
        }
      }

      // 終点到達後は「終点＋軌跡時間」まで時間だけ進めて、移動軌跡を自然に消す
      playheadMs = playheadMs + dt * playbackSpeed;
      update(playheadMs);
      if (playheadMs >= rangeEndMs + recentWindowMs) {
        stop();
        recentLayer.setLatLngs([]);
        return;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  };

  const togglePlayback = () => {
    if (isPlaying) stop();
    else start();
  };

  resetBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stop();
    syncCurrent(rangeStartMs);
  });

  // Leafletのドラッグやクリック抑止の影響を受けにくくする
  playBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    togglePlayback();
  });
  // clickでもイベントが飛ぶ環境があるので、二重発火を避けるため抑止する
  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  speedSelect.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  speedSelect.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // 手動操作を始めたら再生は止める（操作感が安定する）
  rangeWrap.addEventListener('pointerdown', stop);

  // 軌跡表示の調整UI
  const trailTitle = L.DomUtil.create('div', 'gpxv-range-title', container);
  trailTitle.textContent = '軌跡表示';

  const windowRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const windowLabel = L.DomUtil.create('div', 'gpxv-speed-label', windowRow);
  windowLabel.textContent = '軌跡時間';
  const windowSelect = L.DomUtil.create('select', 'gpxv-select', windowRow);
  for (let m = 1; m <= 10; m++) {
    const o = document.createElement('option');
    o.value = String(m);
    o.textContent = `${m}分`;
    windowSelect.appendChild(o);
  }
  const initialMinutes = Math.max(1, Math.min(10, Math.round(recentWindowMs / 60000)));
  windowSelect.value = String(initialMinutes);

  const lightOpacityRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const lightOpacityLabel = L.DomUtil.create('div', 'gpxv-speed-label', lightOpacityRow);
  lightOpacityLabel.textContent = '全体軌跡の濃淡';
  const lightOpacityInput = L.DomUtil.create('input', 'gpxv-input', lightOpacityRow);
  lightOpacityInput.type = 'range';
  lightOpacityInput.min = '0.05';
  lightOpacityInput.max = '0.8';
  lightOpacityInput.step = '0.01';
  lightOpacityInput.value = String(rangeOpacity);

  const lightWeightRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const lightWeightLabel = L.DomUtil.create('div', 'gpxv-speed-label', lightWeightRow);
  lightWeightLabel.textContent = '全体軌跡の太さ';
  const lightWeightInput = L.DomUtil.create('input', 'gpxv-input', lightWeightRow);
  lightWeightInput.type = 'number';
  lightWeightInput.min = '1';
  lightWeightInput.max = '12';
  lightWeightInput.step = '1';
  lightWeightInput.value = String(rangeWeight);

  const darkOpacityRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const darkOpacityLabel = L.DomUtil.create('div', 'gpxv-speed-label', darkOpacityRow);
  darkOpacityLabel.textContent = '移動軌跡の濃淡';
  const darkOpacityInput = L.DomUtil.create('input', 'gpxv-input', darkOpacityRow);
  darkOpacityInput.type = 'range';
  darkOpacityInput.min = '0.1';
  darkOpacityInput.max = '1';
  darkOpacityInput.step = '0.01';
  darkOpacityInput.value = String(recentOpacity);

  const darkWeightRow = L.DomUtil.create('div', 'gpxv-row gpxv-row--mt8', container);
  const darkWeightLabel = L.DomUtil.create('div', 'gpxv-speed-label', darkWeightRow);
  darkWeightLabel.textContent = '移動軌跡の太さ';
  const darkWeightInput = L.DomUtil.create('input', 'gpxv-input', darkWeightRow);
  darkWeightInput.type = 'number';
  darkWeightInput.min = '1';
  darkWeightInput.max = '16';
  darkWeightInput.step = '1';
  darkWeightInput.value = String(recentWeight);

  const applyTrailStyle = () => {
    rangeLayer.setStyle({ opacity: rangeOpacity, weight: rangeWeight });
    recentLayer.setStyle({ opacity: recentOpacity, weight: recentWeight });
    updateRangeUI();
  };

  windowSelect.addEventListener('change', () => {
    const m = Number(windowSelect.value);
    if (!Number.isFinite(m) || m < 1 || m > 10) return;
    recentWindowMs = m * 60 * 1000;
    updateRangeUI();
  });
  lightOpacityInput.addEventListener('input', () => {
    const v = Number(lightOpacityInput.value);
    if (!Number.isFinite(v)) return;
    rangeOpacity = Math.max(0, Math.min(1, v));
    applyTrailStyle();
  });
  lightWeightInput.addEventListener('change', () => {
    const v = Math.round(Number(lightWeightInput.value));
    if (!Number.isFinite(v)) return;
    rangeWeight = Math.max(1, Math.min(12, v));
    lightWeightInput.value = String(rangeWeight);
    applyTrailStyle();
  });
  darkOpacityInput.addEventListener('input', () => {
    const v = Number(darkOpacityInput.value);
    if (!Number.isFinite(v)) return;
    recentOpacity = Math.max(0, Math.min(1, v));
    applyTrailStyle();
  });
  darkWeightInput.addEventListener('change', () => {
    const v = Math.round(Number(darkWeightInput.value));
    if (!Number.isFinite(v)) return;
    recentWeight = Math.max(1, Math.min(16, v));
    darkWeightInput.value = String(recentWeight);
    applyTrailStyle();
  });

  // 地図操作への伝播を抑止（サイドバー操作が安定する）
  for (const el of [startTimeInput, endTimeInput, windowSelect, lightOpacityInput, lightWeightInput, darkOpacityInput, darkWeightInput]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());
  }

  // 初期表示
  syncCurrent(rangeStartMs);
  syncRangeInputs();
  // DOM挿入前は幅が0になり、開始/終了が左に寄ることがあるため次フレームで反映
  requestAnimationFrame(() => {
    updateRangeUI();
  });

  // 画面リサイズ等で幅が変わったときもレイアウトを追従
  const onResize = () => updateRangeUI();
  window.addEventListener('resize', onResize);

  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  return {
    remove: () => {
      try {
        stop();
      } catch {
        // ignore
      }
      try {
        window.removeEventListener('resize', onResize);
      } catch {
        // ignore
      }
      try {
        map.removeLayer(rangeLayer);
      } catch {
        // ignore
      }
      try {
        map.removeLayer(recentLayer);
      } catch {
        // ignore
      }
      try {
        container.remove();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * 目盛り用の時刻を均等に生成（JST表示）
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} count
 */
function buildUniformTickTimes(startMs, endMs, count) {
  const safeCount = Math.max(2, Math.min(12, Math.floor(count || 6)));
  const span = endMs - startMs;
  if (!Number.isFinite(span) || span <= 0) return [startMs, endMs];

  const times = [];
  for (let i = 0; i < safeCount; i++) {
    const t = startMs + (span * i) / (safeCount - 1);
    const rounded = roundToMinute(t);
    times.push(rounded);
  }

  // 重複排除（丸めで同一になることがある）
  const unique = [...new Set(times)];
  if (unique.length < 2) return [startMs, endMs];
  return unique;
}

function roundToMinute(ms) {
  return Math.round(ms / 60000) * 60000;
}

/**
 * 目盛りラベル（時刻だけ）
 * @param {number} ms
 */
function formatTickTimeJst(ms) {
  const dtf = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
  return dtf.format(new Date(ms));
}

/**
 * @param {number[]} timesMs
 * @returns {{ times: number[], indices: number[] }}
 */
function buildTimeIndex(timesMs) {
  const entries = [];
  for (let i = 0; i < timesMs.length; i++) {
    const t = timesMs[i];
    if (Number.isFinite(t)) entries.push({ t, i });
  }
  entries.sort((a, b) => a.t - b.t);
  return {
    times: entries.map((e) => e.t),
    indices: entries.map((e) => e.i),
  };
}

/**
 * @param {number[]} sortedTimes
 * @param {number} target
 * @returns {number} closest index
 */
function findClosestIndex(sortedTimes, target) {
  let lo = 0;
  let hi = sortedTimes.length - 1;
  if (hi <= 0) return 0;

  if (target <= sortedTimes[0]) return 0;
  if (target >= sortedTimes[hi]) return hi;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = sortedTimes[mid];
    if (t === target) return mid;
    if (t < target) lo = mid + 1;
    else hi = mid - 1;
  }

  // hi < lo になっているはず。hiがtarget以下、loがtarget以上。
  const idx1 = Math.max(0, Math.min(sortedTimes.length - 1, hi));
  const idx2 = Math.max(0, Math.min(sortedTimes.length - 1, lo));
  return Math.abs(sortedTimes[idx2] - target) < Math.abs(sortedTimes[idx1] - target) ? idx2 : idx1;
}

/**
 * JSTで日時表示（動画用に分かりやすく）
 * @param {number} ms
 */
function formatDateJst(ms) {
  const dtf = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(new Date(ms));
}

function formatTimeJst(ms) {
  const dtf = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return dtf.format(new Date(ms));
}

/**
 * datetime-local 用の値を JST で生成（環境のローカルTZに依存しない）
 * @param {number} ms
 */
function formatDateTimeLocalValueJst(ms) {
  const parts = getJstParts(ms);
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
}

/**
 * datetime-local の値を JST とみなして epoch ms に変換
 * 許容形式: YYYY-MM-DDTHH:mm / YYYY-MM-DDTHH:mm:ss
 * @param {string} value
 */
function parseDateTimeLocalValueJst(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return NaN;
  // JST(UTC+9) を UTC に戻す
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 60 * 60 * 1000;
  return Number.isFinite(utcMs) ? utcMs : NaN;
}

/**
 * ms を JST とみなした日付パーツを返す（ローカルTZに依存しない）
 * @param {number} ms
 */
function getJstParts(ms) {
  const jst = new Date(Number(ms) + 9 * 60 * 60 * 1000);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
    second: jst.getUTCSeconds(),
  };
}

/**
 * 情報パネル（UI下部）
 * @param {HTMLElement} host
 */
function createInfoPanel(host) {
  host.textContent = '';
  const container = document.createElement('div');
  container.className = 'gpxv-info';
  host.appendChild(container);

  const title = document.createElement('div');
  title.className = 'gpxv-info__title';
  title.textContent = '情報';
  container.appendChild(title);

  const rows = {
    distance: createInfoRow(container, '開始〜終了の距離', '-'),
    duration: createInfoRow(container, '開始〜終了の時間', '-'),
    speed: createInfoRow(container, '平均移動速度（ノット/時）', '-'),
    gps: createInfoRow(container, 'GPS座標', '-'),
  };

  return {
    setDistanceMeters: (meters) => {
      if (!Number.isFinite(meters) || meters < 0) {
        rows.distance.textContent = '-';
        return;
      }
      rows.distance.textContent = formatDistanceMeters(meters);
    },
    setDurationMs: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) {
        rows.duration.textContent = '-';
        return;
      }
      rows.duration.textContent = formatDurationMs(ms);
    },
    setAvgSpeedKnots: (knots) => {
      if (!Number.isFinite(knots) || knots <= 0) {
        rows.speed.textContent = '-';
        return;
      }
      rows.speed.textContent = `${knots.toFixed(2)}`;
    },
    setGpsLatLng: (latlng) => {
      if (!latlng || latlng.length < 2) {
        rows.gps.textContent = '-';
        return;
      }
      const lat = Number(latlng[0]);
      const lon = Number(latlng[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        rows.gps.textContent = '-';
        return;
      }
      rows.gps.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    },
  };
}

function createInfoRow(container, key, initialValue) {
  const row = document.createElement('div');
  row.className = 'gpxv-info__row';
  container.appendChild(row);

  const k = document.createElement('div');
  k.className = 'gpxv-info__key';
  k.textContent = key;
  row.appendChild(k);

  const v = document.createElement('div');
  v.className = 'gpxv-info__value';
  v.textContent = initialValue ?? '-';
  row.appendChild(v);

  return v;
}

/**
 * @param {Array<[number, number]>} latlngs
 */
function computePathDistanceMeters(latlngs) {
  if (!Array.isArray(latlngs) || latlngs.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1];
    const b = latlngs[i];
    if (!a || !b) continue;
    const d = haversineMeters(a[0], a[1], b[0], b[1]);
    if (Number.isFinite(d)) total += d;
  }
  return total;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const r = 6371000;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return r * c;
}

function formatDistanceMeters(meters) {
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

function formatDurationMs(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function computeAvgSpeedKnots(distanceMeters, durationMs) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const hours = durationMs / (1000 * 60 * 60);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const nauticalMiles = distanceMeters / 1852;
  return nauticalMiles / hours;
}

function findFirstIndexGESorted(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] >= value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function findLastIndexLESorted(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function getLatLngAtTimeFromIndex(track, timeIndex, ms) {
  const times = timeIndex?.times ?? [];
  const idxMap = timeIndex?.indices ?? [];
  if (!times.length) return null;
  const t = Math.min(times[times.length - 1], Math.max(times[0], Number(ms)));
  if (!Number.isFinite(t)) return null;
  if (t <= times[0]) return track.latlngs[idxMap[0]] ?? null;
  if (t >= times[times.length - 1]) return track.latlngs[idxMap[idxMap.length - 1]] ?? null;

  let lo = 0;
  let hi = times.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo];
  const t1 = times[hi];
  const p0 = track.latlngs[idxMap[lo]];
  const p1 = track.latlngs[idxMap[hi]];
  if (!p0 || !p1) return p0 ?? p1 ?? null;
  const denom = t1 - t0;
  if (!Number.isFinite(denom) || denom <= 0) return p0;
  const r = Math.min(1, Math.max(0, (t - t0) / denom));
  return [p0[0] + (p1[0] - p0[0]) * r, p0[1] + (p1[1] - p0[1]) * r];
}

/**
 * 現在時刻の移動速度（前後の時間窓で平滑化）を推定する。
 * @param {{ latlngs: Array<[number, number]>, timesMs: number[] }} track
 * @param {{ times: number[], indices: number[] }} timeIndex
 * @param {number} ms
 * @param {number} halfWindowMs
 */
function computeRollingAvgSpeedKnots(track, timeIndex, ms, halfWindowMs) {
  const times = timeIndex?.times ?? [];
  if (!times.length) return null;
  const half = Number.isFinite(halfWindowMs) ? Math.max(5_000, Math.round(halfWindowMs)) : 30_000;
  const center = Number(ms);
  if (!Number.isFinite(center)) return null;
  const minT = times[0];
  const maxT = times[times.length - 1];
  const t0 = Math.max(minT, center - half);
  const t1 = Math.min(maxT, center + half);
  const durationMs = Math.max(0, t1 - t0);
  if (!Number.isFinite(durationMs) || durationMs < 1000) return null;

  const pts = [];
  const pStart = getLatLngAtTimeFromIndex(track, timeIndex, t0);
  if (pStart) pts.push(pStart);

  const i0 = Math.max(0, findFirstIndexGESorted(times, t0));
  const i1 = Math.min(times.length - 1, findLastIndexLESorted(times, t1));
  for (let i = i0; i <= i1; i++) {
    const idx = timeIndex.indices[i];
    const ll = track.latlngs[idx];
    if (!ll) continue;
    pts.push(ll);
  }

  const pEnd = getLatLngAtTimeFromIndex(track, timeIndex, t1);
  if (pEnd) pts.push(pEnd);

  const distanceMeters = computePathDistanceMeters(pts);
  return computeAvgSpeedKnots(distanceMeters, durationMs);
}

/**
 * 速度に応じて色を変える「全体軌跡」レイヤーを作る。
 * Leaflet本体のみで動作するよう、短い線分を速度ビンごとに結合して FeatureGroup にまとめる。
 *
 * - 速い: 明るい（白に近い）
 * - 遅い: 暗い（黒に近い）
 *
 * @param {Array<[number, number]>} latlngs
 * @param {number[]} timesMs
 * @param {{ bins?: number, weight?: number, opacity?: number, unknownOpacity?: number }} opts
 * @returns {any} Leaflet FeatureGroup
 */
function createSpeedGradientTrackLayer(latlngs, timesMs, opts = {}) {
  const bins = Number.isFinite(opts.bins) ? Math.max(6, Math.min(60, Math.round(opts.bins))) : 24;
  const weight = Number.isFinite(opts.weight) ? Math.max(1, Math.min(10, Math.round(opts.weight))) : 3;
  const opacity = Number.isFinite(opts.opacity) ? Math.max(0.05, Math.min(1, Number(opts.opacity))) : 0.82;
  const unknownOpacity = Number.isFinite(opts.unknownOpacity) ? Math.max(0, Math.min(1, Number(opts.unknownOpacity))) : 0.18;

  const group = L.featureGroup();
  if (!Array.isArray(latlngs) || latlngs.length < 2) return group;
  if (!Array.isArray(timesMs) || timesMs.length !== latlngs.length) {
    // time配列が無い/不整合なら単色にフォールバック
    group.addLayer(
      L.polyline(latlngs, {
        color: '#000000',
        weight: 2,
        opacity: 0.18,
        lineCap: 'round',
        lineJoin: 'round',
      })
    );
    return group;
  }

  const segmentSpeeds = [];
  for (let i = 0; i < latlngs.length - 1; i++) {
    const a = latlngs[i];
    const b = latlngs[i + 1];
    const t0 = timesMs[i];
    const t1 = timesMs[i + 1];
    if (!a || !b || !Number.isFinite(t0) || !Number.isFinite(t1)) {
      segmentSpeeds.push(NaN);
      continue;
    }
    const dt = t1 - t0;
    if (!Number.isFinite(dt) || dt <= 0) {
      segmentSpeeds.push(NaN);
      continue;
    }
    const d = haversineMeters(a[0], a[1], b[0], b[1]);
    const k = computeAvgSpeedKnots(d, dt);
    segmentSpeeds.push(Number.isFinite(k) ? k : NaN);
  }

  const finite = segmentSpeeds.filter((v) => Number.isFinite(v) && v >= 0);
  finite.sort((x, y) => x - y);
  const pick = (p) => {
    if (!finite.length) return NaN;
    const r = Math.max(0, Math.min(1, p));
    const idx = Math.round((finite.length - 1) * r);
    return finite[Math.max(0, Math.min(finite.length - 1, idx))];
  };
  // 速度レンジ（knots）
  // 「0〜6kn を暗めに強調」したいので、表示の分割点を 6kn に固定する。
  // 上側（移動）レンジの上限はデータの分布から推定して飽和させる。
  const EMPHASIZE_KNOTS_MAX = 6;
  let maxK = finite.length >= 10 ? pick(0.95) : (finite[finite.length - 1] ?? (EMPHASIZE_KNOTS_MAX + 1));
  if (!Number.isFinite(maxK)) maxK = EMPHASIZE_KNOTS_MAX + 1;
  if (maxK <= EMPHASIZE_KNOTS_MAX) maxK = EMPHASIZE_KNOTS_MAX + 0.1;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // 0〜5kn を暗い側に寄せて強調する（下側に多めの解像度を割り当てる）
  const CUT = 0.55; // 0〜5kn が収まる正規化レンジ（0..1のうち55%）
  const normalizeSpeed = (k) => {
    if (!Number.isFinite(k) || k < 0) return NaN;
    if (k <= EMPHASIZE_KNOTS_MAX) {
      return clamp01((k / EMPHASIZE_KNOTS_MAX) * CUT);
    }
    const denom = Math.max(1e-6, maxK - EMPHASIZE_KNOTS_MAX);
    const r2 = clamp01((k - EMPHASIZE_KNOTS_MAX) / denom);
    return clamp01(CUT + r2 * (1 - CUT));
  };
  const speedToBin = (k) => {
    const r = normalizeSpeed(k);
    const safe = Number.isFinite(r) ? r : 0;
    return Math.max(0, Math.min(bins - 1, Math.floor(safe * (bins - 1) + 1e-9)));
  };
  const binToColor = (bin) => {
    const r = bins <= 1 ? 1 : bin / (bins - 1);
    // 速いほど明るい（白に寄せる）
    // ただし 0〜6kn は暗めに抑える（0..CUT を 10..45% に割当）
    const darkMin = 10;
    const darkMax = 45;
    const brightMax = 94;
    let light;
    if (r <= CUT) {
      const t = CUT > 0 ? r / CUT : 0;
      light = darkMin + t * (darkMax - darkMin);
    } else {
      const t = (r - CUT) / (1 - CUT);
      light = darkMax + t * (brightMax - darkMax);
    }
    return `hsl(0, 0%, ${light.toFixed(1)}%)`;
  };

  let activeBin = null;
  let activePts = null;
  let activeOpacity = opacity;
  let activeColor = null;
  const flush = () => {
    if (!activePts || activePts.length < 2) {
      activePts = null;
      return;
    }
    group.addLayer(
      L.polyline(activePts, {
        color: activeColor ?? '#000000',
        weight,
        opacity: activeOpacity,
        lineCap: 'round',
        lineJoin: 'round',
      })
    );
    activePts = null;
  };

  for (let i = 0; i < latlngs.length - 1; i++) {
    const a = latlngs[i];
    const b = latlngs[i + 1];
    if (!a || !b) continue;
    const k = segmentSpeeds[i];
    const isKnown = Number.isFinite(k);
    const bin = isKnown ? speedToBin(k) : 'unknown';
    if (bin !== activeBin) {
      flush();
      activeBin = bin;
      activePts = [a, b];
      if (bin === 'unknown') {
        activeColor = '#000000';
        activeOpacity = unknownOpacity;
      } else {
        activeColor = binToColor(bin);
        activeOpacity = opacity;
      }
      continue;
    }
    // 同一binなら線分を結合（点を追加して1本にする）
    activePts?.push(b);
  }
  flush();
  return group;
}
