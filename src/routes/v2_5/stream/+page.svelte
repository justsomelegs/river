<script lang="ts">
	let status = $state<'idle' | 'running' | 'complete' | 'cancelled' | 'error'>('idle');
	let messages = $state<{ type: 'note'; text: string; i: number }[]>([]);
	let errorMsg = $state<string | null>(null);
	let controller: AbortController | null = null;

	const start = async () => {
		status = 'running';
		errorMsg = null;
		messages = [];
		controller = new AbortController();

		try {
			const res = await fetch('/v2_5/stream', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'notifications' }),
				signal: controller.signal
			});

			if (!res.ok) {
				status = 'error';
				errorMsg = `HTTP ${res.status}`;
				return;
			}

			const reader = res.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const parts = buffer.split('\n\n');
				buffer = parts.pop() || '';
				for (const part of parts) {
					if (!part.startsWith('data: ')) continue;
					const raw = part.replace('data: ', '').trim();
					try {
						const json = JSON.parse(raw);
						if (json && json.type === 'note') {
							messages.push(json);
						}
					} catch (e) {
						// ignore malformed
					}
				}
			}

			status = 'complete';
		} catch (e: any) {
			if (controller?.signal.aborted) {
				status = 'cancelled';
			} else {
				status = 'error';
				errorMsg = e?.message ?? 'Unknown error';
			}
		}
	};

	const stop = () => {
		controller?.abort();
	};
</script>

<div class="mx-auto max-w-xl space-y-4 p-6">
	<h1 class="text-2xl font-semibold">v2.5 Notifications Stream Demo</h1>

	<div class="flex gap-2">
		<button
			onclick={start}
			disabled={status === 'running'}
			class="rounded-md bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
		>
			{status === 'running' ? 'Running…' : 'Start'}
		</button>
		<button
			onclick={stop}
			disabled={status !== 'running'}
			class="rounded-md bg-red-600 px-3 py-2 text-white disabled:opacity-50"
		>
			Stop
		</button>
		<span class="rounded bg-neutral-800 px-2 py-1 text-sm">Status: {status}</span>
	</div>

	{#if errorMsg}
		<div class="rounded-md bg-red-900/30 p-3 text-red-200">Error: {errorMsg}</div>
	{/if}

	<div class="rounded-md bg-neutral-900 p-3">
		<h2 class="text-sm text-neutral-300">Messages</h2>
		{#if messages.length === 0}
			<p class="text-neutral-500">No messages yet.</p>
		{:else}
			<ul class="space-y-2">
				{#each messages as m}
					<li class="rounded bg-neutral-800 p-2 text-neutral-100">[{m.i}] {m.text}</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
