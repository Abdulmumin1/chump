export type SidebarSwipeState = {
    open: boolean;
    isDragging: boolean;
    dragOffset: number;
};

export function sidebarSwipe(
    node: HTMLElement,
    options: {
        open: boolean;
        onStateChange: (state: SidebarSwipeState) => void;
    },
) {
    let open = options.open;
    let touchStartX: number | null = null;
    let touchStartY: number | null = null;
    let touchCurrentX: number | null = null;
    let touchStartTime = 0;
    let isDragging = false;
    let dragDirectionLocked = false;

    const emit = (next: Partial<SidebarSwipeState> = {}) => {
        options.onStateChange({
            open,
            isDragging,
            dragOffset:
                touchCurrentX !== null && touchStartX !== null
                    ? touchCurrentX - touchStartX
                    : 0,
            ...next,
        });
    };

    const handleTouchStart = (event: TouchEvent) => {
        if (
            event.target instanceof Element &&
            event.target.closest('pre, code, [class*="overflow-x"]')
        ) {
            return;
        }

        const x = event.touches[0].clientX;
        const y = event.touches[1] ? null : event.touches[0].clientY;
        if (!open && x > window.innerWidth / 2) return;

        touchStartX = x;
        touchStartY = y;
        touchCurrentX = x;
        touchStartTime = Date.now();
        isDragging = true;
        dragDirectionLocked = false;
        emit();
    };

    const handleTouchMove = (event: TouchEvent) => {
        if (!isDragging || touchStartX === null) return;

        const currentX = event.touches[0].clientX;
        const currentY = event.touches[0].clientY;

        if (!dragDirectionLocked && touchStartY !== null) {
            const dx = Math.abs(currentX - touchStartX);
            const dy = Math.abs(currentY - touchStartY);

            if (dx > 10 || dy > 10) {
                if (dy > dx) {
                    isDragging = false;
                    emit({ isDragging: false, dragOffset: 0 });
                    return;
                }
                dragDirectionLocked = true;
                event.preventDefault();
            } else {
                touchCurrentX = currentX;
                emit();
                return;
            }
        }

        touchCurrentX = currentX;
        if (dragDirectionLocked) {
            event.preventDefault();
        }
        emit();
    };

    const handleTouchEnd = () => {
        if (!isDragging || touchStartX === null || touchCurrentX === null) {
            return;
        }

        if (!dragDirectionLocked) {
            isDragging = false;
            touchStartX = null;
            touchCurrentX = null;
            emit({ isDragging: false, dragOffset: 0 });
            return;
        }

        const deltaX = touchCurrentX - touchStartX;
        const velocity = deltaX / Math.max(1, Date.now() - touchStartTime);

        let nextOpen = open;
        if (!open) {
            if (deltaX > 60 || velocity > 0.3) nextOpen = true;
        } else if (deltaX < -60 || velocity < -0.3) {
            nextOpen = false;
        }

        open = nextOpen;
        isDragging = false;
        touchStartX = null;
        touchCurrentX = null;
        emit({ open, isDragging: false, dragOffset: 0 });
    };

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchmove", handleTouchMove, { passive: false });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });
    node.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return {
        update(next: typeof options) {
            options = next;
            open = next.open;
        },
        destroy() {
            node.removeEventListener("touchstart", handleTouchStart);
            node.removeEventListener("touchmove", handleTouchMove);
            node.removeEventListener("touchend", handleTouchEnd);
            node.removeEventListener("touchcancel", handleTouchEnd);
        },
    };
}
