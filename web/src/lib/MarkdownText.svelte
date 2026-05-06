<script lang="ts">
	import { marked } from 'marked';

	let { text } = $props<{ text: string }>();

	marked.setOptions({
		gfm: true,
		breaks: true
	});

	let html = $derived(marked.parse(text) as string);
</script>

<div class="markdown-body text-[14px] leading-relaxed text-[#cccccc]" >
	{@html html}
</div>

<style>
	:global(.markdown-body p) {
		margin: 0 0 1rem 0;
	}

	:global(.markdown-body p:last-child) {
		margin-bottom: 0;
	}

	:global(.markdown-body strong) {
		font-weight: 700;
		color: #f4f4f5;
	}

	:global(.markdown-body em) {
		font-style: italic;
	}

	:global(.markdown-body code) {
		font-family: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		font-size: 0.92em;
		background: #242426;
		border: 1px solid #313133;
		border-radius: 6px;
		padding: 0.08rem 0.35rem;
		color: #e4e4e7;
	}

	:global(.markdown-body pre) {
		margin: 0 0 1rem 0;
		padding: 0.9rem 1rem;
		overflow-x: auto;
		background: #1e1e1e;
		border: 1px solid #313133;
		border-radius: 8px;
	}

	:global(.markdown-body pre code) {
		background: transparent;
		border: 0;
		padding: 0;
		border-radius: 0;
		color: inherit;
	}

	:global(.markdown-body ul),
	:global(.markdown-body ol) {
		margin: 0 0 1rem 0;
		padding-left: 1.4rem;
	}

	:global(.markdown-body li) {
		margin: 0.2rem 0;
	}

	:global(.markdown-body a) {
		color: #7bb6ef;
		text-decoration: none;
	}

	:global(.markdown-body a:hover) {
		text-decoration: underline;
	}

	:global(.markdown-body blockquote) {
		margin: 0 0 1rem 0;
		padding-left: 1rem;
		border-left: 2px solid #313133;
		color: #a1a1aa;
	}

	:global(.markdown-body h1),
	:global(.markdown-body h2),
	:global(.markdown-body h3),
	:global(.markdown-body h4) {
		margin: 0 0 0.75rem 0;
		font-weight: 700;
		color: #f4f4f5;
	}

	:global(.markdown-body hr) {
		margin: 1rem 0;
		border: 0;
		border-top: 1px solid #313133;
	}
</style>
