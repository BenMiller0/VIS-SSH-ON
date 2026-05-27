'use strict';

/**
 * static/js/core/events.js
 *
 * Lightweight publish/subscribe event bus.
 * Core infrastructure modules emit named events, and partial-specific page
 * modules subscribe without taking direct dependencies on socket managers or
 * unrelated views.
 *
 * Standard event catalogue:
 * - ws:camera:open / ws:camera:close / ws:camera:frame
 * - ws:thermal:open / ws:thermal:close / ws:thermal:data
 * - ws:test:open / ws:test:close / ws:test:message
 * - ws:keypoint:open / ws:keypoint:close / ws:keypoint:data
 * - connection:lost
 *
 * Architecture notes:
 * - keeps page modules decoupled from transport modules
 * - supports event-driven UI updates without a framework
 * - subscriber errors are isolated so one bad handler cannot stop the rest
 */

/** @type {Map<string, Set<Function>>} */
const listenersByEvent = new Map();

export function on(eventName, callback) {
    if (!listenersByEvent.has(eventName)) {
        listenersByEvent.set(eventName, new Set());
    }

    listenersByEvent.get(eventName).add(callback);
}

export function off(eventName, callback) {
    const listeners = listenersByEvent.get(eventName);

    if (!listeners) {
        return;
    }

    listeners.delete(callback);
}

export function emit(eventName, payload) {
    const listeners = listenersByEvent.get(eventName);

    if (!listeners) {
        return;
    }

    listeners.forEach(callback => {
        try {
            callback(payload);
        } catch (error) {
            console.error(`[events] Uncaught error in handler for "${eventName}":`, error);
        }
    });
}
