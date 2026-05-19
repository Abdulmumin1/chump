import { browser } from "$app/environment";

export type AppTheme = "light" | "dark";

export function getDocumentTheme(): AppTheme {
	if (!browser) {
		return "light";
	}
	return document.documentElement.classList.contains("dark")
		? "dark"
		: "light";
}

export function observeDocumentTheme(
	onChange: (theme: AppTheme) => void,
): () => void {
	if (!browser) {
		return () => {};
	}

	const root = document.documentElement;
	const emit = () => {
		onChange(getDocumentTheme());
	};

	emit();

	const observer = new MutationObserver(() => {
		emit();
	});
	observer.observe(root, {
		attributes: true,
		attributeFilter: ["class"],
	});

	return () => {
		observer.disconnect();
	};
}
