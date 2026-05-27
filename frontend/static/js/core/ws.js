'use strict';

/**
 * static/js/core/ws.js
 *
 * Singleton WebSocket connection manager.
 * Owns persistent socket lifecycles for camera frames, thermal data, test run
 * events, and keypoint updates. Page modules receive data through events.js so
 * no partial directly opens or tracks long-lived transport connections.
 *
 * Architecture notes:
 * - ES module caching gives this file one shared socket registry
 * - automatic reconnect keeps transient disconnects recoverable
 * - event-driven output keeps transport concerns isolated from rendering code
 */

import { emit } from './events.js';

const DEFAULT_RECONNECT_DELAY_MS = 1000;

const SOCKET_DEFINITIONS = {
    camera: {
        path: '/ws',
        expectsBinary: true,
        eventName: 'ws:camera:frame',
    },
    thermal: {
        path: '/ws/thermal',
        expectsBinary: false,
        eventName: 'ws:thermal:data',
        parseJson: true,
    },
    test: {
        path: '/ws/test',
        expectsBinary: false,
        eventName: 'ws:test:message',
        parseJson: true,
    },
    keypoint: {
        path: '/ws/keypoint',
        expectsBinary: false,
        eventName: 'ws:keypoint:data',
        parseJson: true,
    },
};

/** @type {Map<string, WebSocket>} */
const openSocketsByType = new Map();

/** @type {Set<string>} */
const deliberatelyClosedTypes = new Set();

function buildBaseUrl() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${location.host}`;
}

function parseSocketPayload(socketType, data) {
    const definition = SOCKET_DEFINITIONS[socketType];

    if (!definition.parseJson) {
        return data;
    }

    return JSON.parse(data);
}

function openSocket(socketType) {
    if (openSocketsByType.has(socketType)) {
        return;
    }

    const definition = SOCKET_DEFINITIONS[socketType];
    deliberatelyClosedTypes.delete(socketType);

    const socket = new WebSocket(`${buildBaseUrl()}${definition.path}`);

    if (definition.expectsBinary) {
        socket.binaryType = 'blob';
    }

    openSocketsByType.set(socketType, socket);

    socket.onopen = () => {
        emit(`ws:${socketType}:open`);
    };

    socket.onmessage = event => {
        try {
            emit(definition.eventName, parseSocketPayload(socketType, event.data));
        } catch (error) {
            console.error(`[ws] Failed to handle ${socketType} message:`, error);
        }
    };

    socket.onerror = () => {
        emit('connection:lost', { type: socketType });
    };

    socket.onclose = () => {
        openSocketsByType.delete(socketType);
        emit(`ws:${socketType}:close`);

        if (deliberatelyClosedTypes.has(socketType)) {
            return;
        }

        setTimeout(() => {
            if (!deliberatelyClosedTypes.has(socketType)) {
                openSocket(socketType);
            }
        }, DEFAULT_RECONNECT_DELAY_MS);
    };
}

export function connectAllWebSockets() {
    Object.keys(SOCKET_DEFINITIONS).forEach(openSocket);
}

export function disconnect(socketType) {
    deliberatelyClosedTypes.add(socketType);

    const socket = openSocketsByType.get(socketType);
    if (!socket) {
        return;
    }

    socket.onclose = null;
    socket.close();
    openSocketsByType.delete(socketType);
}

export function disconnectAll() {
    Array.from(openSocketsByType.keys()).forEach(disconnect);
}

export function isConnected(socketType) {
    const socket = openSocketsByType.get(socketType);
    return socket?.readyState === WebSocket.OPEN;
}
