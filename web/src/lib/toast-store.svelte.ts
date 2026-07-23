export type ToastItem = {
	id: number;
	message: string;
	type?: 'default' | 'success' | 'error';
};

class ToastStore {
	items = $state<ToastItem[]>([]);

	add(message: string, type: 'default' | 'success' | 'error' = 'success', duration = 3000): void {
		if (!message) return;
		if (this.items.some((t) => t.message === message)) return;

		const id = Date.now() + Math.random();
		this.items.push({ id, message, type });

		if (typeof window !== 'undefined') {
			setTimeout(() => {
				this.remove(id);
			}, duration);
		}
	}

	remove(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toastStore = new ToastStore();

export function addToast(
	message: string,
	type: 'default' | 'success' | 'error' = 'success',
	duration = 3000
): void {
	toastStore.add(message, type, duration);
}

export function removeToast(id: number): void {
	toastStore.remove(id);
}
