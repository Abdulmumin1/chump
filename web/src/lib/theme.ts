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

export function setDocumentTheme(theme: AppTheme) {
	if (!browser) return;
	localStorage.setItem("theme", theme);
	if (theme === "dark") {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}
	const meta = document.getElementById("theme-color-meta") as HTMLMetaElement | null;
	if (meta) meta.content = theme === "dark" ? "#0a0a0a" : "#f7f4f0";
}
