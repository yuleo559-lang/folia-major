import { useRef, useState } from 'react';

// src/hooks/useDragToScroll.ts
// Drag-to-scroll for the horizontal settings chip strip on narrow layouts.

/** Movement past this many pixels counts as a drag, so the release does not also select a chip. */
const DRAG_THRESHOLD_PX = 5;
type ActiveDrag = {
    pointerId: number;
    startX: number;
    initialScrollLeft: number;
    didMove: boolean;
};

export interface DragToScrollBinding {
    isDragging: boolean;
    /** True when the pointer moved far enough that the release should not be treated as a click. */
    hasDragged: () => boolean;
    handlers: {
        onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
        onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
        onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
        onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
        onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
        onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => void;
    };
}

export const useDragToScroll = (scrollContainerRef: React.RefObject<HTMLDivElement | null>): DragToScrollBinding => {
    const [isDragging, setIsDragging] = useState(false);
    const activeDragRef = useRef<ActiveDrag | null>(null);
    const hasDraggedRef = useRef(false);

    const finishPointer = (pointerId: number) => {
        if (activeDragRef.current?.pointerId !== pointerId) return;
        activeDragRef.current = null;
        setIsDragging(false);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
        hasDraggedRef.current = false;
        // Touch and pen input use the browser's native horizontal scrolling; only mouse input is custom-dragged.
        if (event.pointerType !== 'mouse' || event.button !== 0 || !scrollContainerRef.current) return;
        activeDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            initialScrollLeft: scrollContainerRef.current.scrollLeft,
            didMove: false,
        };
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
        const drag = activeDragRef.current;
        const container = scrollContainerRef.current;
        if (!drag || drag.pointerId !== event.pointerId || !container) return;
        const deltaX = event.clientX - drag.startX;
        if (!drag.didMove && Math.abs(deltaX) <= DRAG_THRESHOLD_PX) return;
        if (!drag.didMove) {
            drag.didMove = true;
            hasDraggedRef.current = true;
            setIsDragging(true);
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.setPointerCapture(event.pointerId);
            }
        }
        event.preventDefault();
        container.scrollLeft = drag.initialScrollLeft - deltaX;
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => finishPointer(event.pointerId);
    const handlePointerCancel = (event: React.PointerEvent<HTMLElement>) => finishPointer(event.pointerId);
    const handleLostPointerCapture = (event: React.PointerEvent<HTMLElement>) => finishPointer(event.pointerId);
    const handlePointerLeave = (event: React.PointerEvent<HTMLElement>) => {
        const drag = activeDragRef.current;
        if (drag && drag.pointerId === event.pointerId && !drag.didMove) finishPointer(event.pointerId);
    };

    return {
        isDragging,
        hasDragged: () => hasDraggedRef.current,
        handlers: {
            onPointerDown: handlePointerDown,
            onPointerLeave: handlePointerLeave,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onPointerCancel: handlePointerCancel,
            onLostPointerCapture: handleLostPointerCapture,
        },
    };
};

export default useDragToScroll;
