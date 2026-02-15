export class Main {
	/**
	 * @param {{ gpxUrl?: string, zoomThreshold?: number }} params
	 */
	constructor(params = {}) {
		this.params = params;
		this.map = null;
		this.trackLayer = null;
		this.marker = null;
		this.timeControl = null;
		this.uploadControl = null;
		this.infoPanel = null;
	}

	async initialize() {
		this.#initMap();
		this.#ensureUploadControl();
		this.#ensureInfoPanel();
		// 初期状態では「情報」UIを非表示
		try {
			this.#getInfoRoot().style.display = 'none';
		} catch {
			// ignore
		}
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

		// 全体の軌跡（ベース）
		this.trackLayer = L.polyline(latlngs, {
			color: 'rgba(0,0,0,0.35)',
			weight: 3,
			opacity: 0.9,
		}).addTo(this.map);
		this.map.fitBounds(this.trackLayer.getBounds(), { padding: [20, 20] });

		// 時刻スライダ + マーカー（GPXにtimeがある場合）
		if (track.timesMs.length) {
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
						this.infoPanel?.setDistanceMeters(distanceMeters);
						this.infoPanel?.setDurationMs(durationMs);
						this.infoPanel?.setAvgSpeedKnots(avgSpeedKnots);
						this.infoPanel?.setGpsLatLng(latlng);
					},
				}
			);
		} else {
			console.warn('GPXにtime要素が見つからなかったため、時間スライダは表示しません。');
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
				const demoUrl = this.params.gpxUrl ?? './data/kaichouzuV_route_14_20260214_205630.gpx';
				const track = await loadGpxTrack(demoUrl);
				this.#renderTrack(track, demoUrl);
			}
		);
	}

	#initMap() {
		if (this.map) return;

		this.map = L.map('map', {
			zoomControl: true,
		});

		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 19,
			attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		}).addTo(this.map);

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

/**
 * 画像を追加せず、CSSで見た目を整えたマーカーアイコン
 */
function createCuteMarkerIcon() {
	return L.divIcon({
		className: 'gpxv-marker',
		html: '<div class="gpxv-marker__dot"></div>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
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
	let recentWindowMs = Number.isFinite(opts.recentWindowMs) && opts.recentWindowMs > 0 ? opts.recentWindowMs : 5 * 60 * 1000;

	const container = L.DomUtil.create('div', 'gpxv-control gpxv-control--time', host);

	// 日付と時刻（横並び）
	const dateTimeRow = L.DomUtil.create('div', 'gpxv-datetime', container);
	const dateLabel = L.DomUtil.create('div', 'gpxv-label', dateTimeRow);
	const timeLabel = L.DomUtil.create('div', 'gpxv-label', dateTimeRow);

		const sliderMin = timeIndex.times[0];
		const sliderMax = timeIndex.times[timeIndex.times.length - 1];

		const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
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

		// 選択範囲の軌跡（薄い色・細め）
		let rangeOpacity = 0.25;
		let rangeWeight = 4;
		let recentOpacity = 0.8;
		let recentWeight = 10;

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

		// 選択区間の表示
		const rangeText = L.DomUtil.create('div', 'gpxv-range-text', container);

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

		const renderRangeText = () => {
			normalizeRange();
			rangeText.textContent = `範囲: ${formatTimeJst(rangeStartMs)} 〜 ${formatTimeJst(rangeEndMs)}`;
		};

		const updateRangeUI = () => {
			normalizeRange();
			const beforeCurrent = currentMs;
			clampCurrent();
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
			const safeMs = clamp(ms, sliderMin, sliderMax);
			const latlng = getLatLngAtTime(safeMs);
			if (!latlng) return;
			track.marker.setLatLng(latlng);
			dateLabel.textContent = formatDateJst(safeMs);
			timeLabel.textContent = formatTimeJst(safeMs);

			// 再生中も「過去一定時間」の濃い軌跡が追従するよう更新
			const recentStartMs = Math.max(rangeStartMs, safeMs - recentWindowMs);
			const ptsRecent = [];
			const llRecentStart = getLatLngAtTime(recentStartMs);
			if (llRecentStart) ptsRecent.push(llRecentStart);
			for (let i = 0; i < track.timesMs.length; i++) {
				const t = track.timesMs[i];
				if (!Number.isFinite(t)) continue;
				if (t < recentStartMs || t > safeMs) continue;
				const ll = track.latlngs[i];
				if (!ll) continue;
				ptsRecent.push(ll);
			}
			ptsRecent.push(latlng);
			recentLayer.setLatLngs(ptsRecent);
			recentLayer.bringToFront();
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

		const syncCurrent = (ms) => {
			normalizeRange();
			let c = Number(ms);
			if (!Number.isFinite(c)) c = rangeStartMs;
			currentMs = clamp(c, rangeStartMs, rangeEndMs);
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
				renderRangeText();
				return;
			}
			if (which === 'end') {
				rangeEndMs = Math.max(snapped, rangeStartMs);
				updateRangeUI();
				renderRangeText();
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

		for (const opt of speedOptions) {
			const o = document.createElement('option');
			o.value = String(opt.value);
			o.textContent = opt.label;
			speedSelect.appendChild(o);
		}

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

		playbackSpeed = snapSpeed(playbackSpeed);
		speedSelect.value = String(playbackSpeed);

		speedSelect.addEventListener('change', () => {
			const v = Number(speedSelect.value);
			if (!Number.isFinite(v) || v <= 0) return;
			playbackSpeed = v;
		});

		let isPlaying = false;
		let rafId = 0;
		let lastNow = 0;

		const stop = () => {
			if (!isPlaying) return;
			isPlaying = false;
			playBtn.textContent = '再生';
			if (rafId) cancelAnimationFrame(rafId);
			rafId = 0;
		};

		const start = () => {
			if (isPlaying) return;
			normalizeRange();
			clampCurrent();
			// 現在位置→終了まで再生。すでに終了以降なら開始に戻してから再生。
			if (!Number.isFinite(currentMs) || currentMs >= rangeEndMs) {
				syncCurrent(rangeStartMs);
			} else {
				syncCurrent(currentMs);
			}
			isPlaying = true;
			playBtn.textContent = '停止';
			lastNow = performance.now();
			const loop = (now) => {
				if (!isPlaying) return;
				const dt = Math.min(100, now - lastNow);
				lastNow = now;
				const next = currentMs + dt * playbackSpeed;
				if (next >= rangeEndMs) {
					syncCurrent(rangeEndMs);
					stop();
					return;
				}
				syncCurrent(next);
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
		for (const el of [windowSelect, lightOpacityInput, lightWeightInput, darkOpacityInput, darkWeightInput]) {
			el.addEventListener('pointerdown', (e) => e.stopPropagation());
			el.addEventListener('click', (e) => e.stopPropagation());
		}

		// 初期表示
		syncCurrent(rangeStartMs);
		renderRangeText();
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
