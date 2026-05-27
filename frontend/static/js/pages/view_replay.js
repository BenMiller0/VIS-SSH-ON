'use strict';

/**
 * static/js/pages/view_replay.js
 *
 * Controller for partials/view_replay.html.
 * Owns failure replay rendering, timeline notes, frame preloading, playback,
 * pause behavior, and scrubber interaction.
 *
 * Architecture notes:
 * - replay frame cache lives in appState.replayState for cross-view persistence
 * - API calls are isolated to report/replay artifact loading
 * - Reports view selects a run, then this module renders the selected replay
 */

import { api } from '../core/api.js';
import { appState, replayState } from '../core/state.js';
import { $, escapeHtml } from '../core/ui.js';

function stopReplayPlayback() {
    if (!replayState.timer) {
        return;
    }

    clearInterval(replayState.timer);
    replayState.timer = null;
}

function resetReplayState(runId = null) {
    stopReplayPlayback();
    replayState.runId = runId;
    replayState.frames = [];
    replayState.index = 0;
    replayState.cache.clear();
}

function ensureReplayShell(frame) {
    let image = $('#replay-image');
    let badge = $('#replay-badge');

    if (!image || !badge) {
        frame.innerHTML = `
            <img id="replay-image" class="replay-image" data-camera-orientable alt="Replay frame" />
            <div id="replay-badge" class="replay-badge"></div>
            <div id="replay-loading" class="replay-loading">Loading frame...</div>
        `;
        image = $('#replay-image');
        badge = $('#replay-badge');
    }

    return {
        image,
        badge,
        loading: $('#replay-loading'),
    };
}

function preloadReplayFrame(item) {
    if (!item?.url) {
        return Promise.resolve(null);
    }

    if (replayState.cache.has(item.url)) {
        return replayState.cache.get(item.url);
    }

    const loadPromise = new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = item.url;
    });

    replayState.cache.set(item.url, loadPromise);
    return loadPromise;
}

function warmReplayCache(index) {
    for (let offset = 1; offset <= 3; offset += 1) {
        const next = replayState.frames[(index + offset) % replayState.frames.length];
        preloadReplayFrame(next);
    }
}

async function showReplayFrame(index) {
    const frame = $('#replay-frame');
    const scrubber = $('#replay-scrubber');
    if (!frame || !replayState.frames.length) {
        return;
    }

    const clamped = Math.max(0, Math.min(replayState.frames.length - 1, index));
    const item = replayState.frames[clamped];
    const { image, badge, loading } = ensureReplayShell(frame);

    if (loading && !image.src) {
        loading.classList.add('active');
    }

    const loaded = await preloadReplayFrame(item);
    if (replayState.frames[clamped] !== item) {
        return;
    }

    if (loaded) {
        image.src = loaded.src;
        image.classList.add('loaded');
        replayState.index = clamped;

        if (scrubber) {
            scrubber.value = String(clamped);
        }

        if (badge) {
            badge.textContent = item.timestamp ?? '';
        }

        if (loading) {
            loading.classList.remove('active');
        }

        warmReplayCache(clamped);
        return;
    }

    if (loading) {
        loading.textContent = 'Frame failed to load';
        loading.classList.add('active');
    }
}

function playReplay() {
    if (replayState.timer || replayState.frames.length <= 1) {
        return;
    }

    replayState.timer = setInterval(() => {
        const nextIndex = replayState.index + 1 >= replayState.frames.length
            ? 0
            : replayState.index + 1;
        showReplayFrame(nextIndex);
    }, 140);
}

export function renderReplay(run) {
    const title = $('#replay-title');
    const frame = $('#replay-frame');
    const notes = $('#replay-notes');
    const timeline = $('#replay-timeline');
    const scrubber = $('#replay-scrubber');
    const playButton = $('#replay-play-btn');
    const pauseButton = $('#replay-pause-btn');

    if (!title || !frame || !notes || !timeline) {
        return;
    }

    if (!run) {
        resetReplayState();
        title.textContent = 'Replay';
        frame.innerHTML = '<span>No replay selected</span>';
        notes.textContent = 'Select a failed report to inspect.';
        timeline.innerHTML = '';
        setReplayControlsEnabled(false, scrubber, playButton, pauseButton);
        return;
    }

    resetReplayState(run.id);

    const failure = appState.lastFailureByRun[run.id];
    title.textContent = `Run #${run.id}`;
    frame.innerHTML = run.status === 'fail'
        ? '<span>Loading replay...</span>'
        : '<span>No failure replay for this run</span>';

    notes.innerHTML = buildReplayNotes(run, failure);
    timeline.innerHTML = buildInitialTimeline(run, failure);
    setReplayControlsEnabled(false, scrubber, playButton, pauseButton);

    if (run.status === 'fail') {
        loadReplayArtifact(run.id);
    }
}

function setReplayControlsEnabled(enabled, scrubber, playButton, pauseButton) {
    if (scrubber) {
        scrubber.disabled = !enabled;
    }

    if (playButton) {
        playButton.disabled = !enabled;
    }

    if (pauseButton) {
        pauseButton.disabled = !enabled;
    }
}

function buildReplayNotes(run, failure) {
    const metricRows = failure?.metric
        ? Object.entries(failure.metric)
            .filter(([key]) => key !== 'type')
            .map(([key, value]) => `<div class="metric-line"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
            .join('')
        : '';

    return `
        <div class="metric-line"><span>Status</span><strong>${escapeHtml(run.status)}</strong></div>
        <div class="metric-line"><span>Reason</span><strong>${escapeHtml(run.failure_reason || failure?.reason || '-')}</strong></div>
        ${metricRows}
    `;
}

function buildInitialTimeline(run, failure) {
    const events = [
        ['Start', run.start_time],
        ['Failure', run.failure_reason || failure?.reason || (run.status === 'fail' ? 'Failed' : '-')],
        ['End', run.end_time || '-'],
    ];

    return events
        .map(([label, value]) => `<div class="timeline-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join('');
}

async function loadReplayArtifact(runId) {
    const frame = $('#replay-frame');
    const notes = $('#replay-notes');
    const timeline = $('#replay-timeline');
    const scrubber = $('#replay-scrubber');
    const playButton = $('#replay-play-btn');
    const pauseButton = $('#replay-pause-btn');

    if (!frame || !notes || !timeline || !scrubber || !playButton || !pauseButton) {
        return;
    }

    try {
        const [report, replay] = await Promise.all([
            api.getRunReport(runId),
            api.getRunReplay(runId),
        ]);

        const failureEvent = report?.events?.find(event => event.event_type === 'failure');
        if (failureEvent?.payload) {
            notes.innerHTML = Object.entries(failureEvent.payload)
                .map(([key, value]) => `<div class="metric-line"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
                .join('');
        }

        if (!replay?.available || !replay.frames?.length) {
            frame.innerHTML = '<span>No replay frames saved for this run</span>';
            return;
        }

        replayState.runId = runId;
        replayState.frames = replay.frames;
        replayState.index = 0;
        replayState.cache.clear();
        ensureReplayShell(frame);

        scrubber.min = '0';
        scrubber.max = String(replay.frames.length - 1);
        setReplayControlsEnabled(true, scrubber, playButton, pauseButton);

        scrubber.oninput = () => {
            stopReplayPlayback();
            showReplayFrame(parseInt(scrubber.value, 10));
        };
        playButton.onclick = playReplay;
        pauseButton.onclick = stopReplayPlayback;

        timeline.innerHTML = replay.events
            .map(event => `<div class="timeline-item"><span>${escapeHtml(event.event_type)}</span><strong>${escapeHtml(event.message || event.timestamp)}</strong></div>`)
            .join('');

        await Promise.all(replay.frames.slice(0, 4).map(preloadReplayFrame));
        showReplayFrame(0);
    } catch (error) {
        frame.innerHTML = '<span>Replay failed to load</span>';
        console.error(error);
    }
}

export function initViewReplay() {
    renderReplay(appState.selectedRun);
}
