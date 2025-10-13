<script lang="ts">
	import type { River } from './+server.js';
	import { createRiverClient } from '$lib/v2_5_dev/index.js';

	const client = createRiverClient<River>({
		endpoint: '/v2_5/stream',
		retry: {
			attempts: 3,
			delayMs: 1000,
			exponentialBackoff: true
		}
	});

	const vowelCounter = client.stream.vowelCounter({
		onStart() {
			vowelStatus = 'running';
			vowelChunks = [];
			vowelError = null;
		},
		onChunk(chunk) {
			vowelChunks.push(chunk);
		},
		onComplete(summary) {
			vowelStatus = summary.status;
		},
		onCancel() {
			vowelStatus = 'canceled';
		},
		onError(error) {
			vowelStatus = 'error';
			vowelError = error instanceof Error ? error.message : 'Unknown error';
		},
		onStreamInfo() {}
	});

	let vowelStatus = $state<string>('idle');
	let vowelChunks = $state<any[]>([]);
	let vowelError = $state<string | null>(null);
	let vowelInput = $state('Hello World');

	const questionAsker = client.stream.questionAsker({
		onStart() {
			qaStatus = 'running';
			qaChunks = [];
			qaError = null;
		},
		onChunk(chunk) {
			qaChunks.push(chunk);
		},
		onComplete(summary) {
			qaStatus = summary.status;
		},
		onCancel() {
			qaStatus = 'canceled';
		},
		onError(error) {
			qaStatus = 'error';
			qaError = error instanceof Error ? error.message : 'Unknown error';
		}
	});

	let qaStatus = $state<string>('idle');
	let qaChunks = $state<any[]>([]);
	let qaError = $state<string | null>(null);
	let qaInput = $state('What is the capital of France?');

	const simpleChat = client.stream.simpleChat({
		onStart() {
			chatStatus = 'running';
			chatText = '';
			chatError = null;
		},
		onChunk(chunk) {
			chatText += chunk;
		},
		onComplete(summary) {
			chatStatus = summary.status;
		},
		onCancel() {
			chatStatus = 'canceled';
		},
		onError(error) {
			chatStatus = 'error';
			chatError = error instanceof Error ? error.message : 'Unknown error';
		}
	});

	let chatStatus = $state<string>('idle');
	let chatText = $state('');
	let chatError = $state<string | null>(null);
	let chatInput = $state('Tell me a joke');

	let resumableStatus = $state<string>('idle');
	let resumableChunks = $state<Array<{ chunk: any; isNew: boolean }>>([]);
	let resumableError = $state<string | null>(null);
	let resumableRunId = $state<string | null>(null);
	let resumableUseStableId = $state(true); // Enable resumability
	let resumableStableId = $state('demo-resumable-session-1');
	let resumableKeepOldChunks = $state(true); // Toggle to keep old chunks

	const resumableStream = client.stream.resumableStream({
		onStart() {
			resumableStatus = 'running';
			if (!resumableKeepOldChunks) {
				resumableChunks = [];
			} else {
				// Mark existing chunks as old
				resumableChunks = resumableChunks.map((c) => ({ ...c, isNew: false }));
			}
			resumableError = null;
		},
		onChunk(chunk) {
			resumableChunks.push({ chunk, isNew: true });
		},
		onComplete(summary) {
			resumableStatus = summary.status;
			resumableRunId = summary.runId; // Save runId for potential resumption
		},
		onCancel() {
			resumableStatus = 'canceled';
		},
		onError(error) {
			resumableStatus = 'error';
			resumableError = error instanceof Error ? error.message : 'Unknown error';
		},
		onStreamInfo(info) {
			resumableRunId = info.runId;
		}
	});
</script>

<div class="mx-auto max-w-4xl space-y-6 p-6">
	<div class="space-y-2">
		<h1 class="text-3xl font-bold">v2.5 River Stream Tests</h1>
		<p class="text-neutral-400">
			Comprehensive tests demonstrating v2.5 has full parity with v3 (and more!)
		</p>
	</div>

	<!-- Vowel Counter Test -->
	<div class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<h2 class="text-xl font-semibold">Vowel Counter Test</h2>
		<p class="text-sm text-neutral-400">Custom stream with beforeRun/afterRun hooks</p>

		<div class="flex gap-2">
			<input
				bind:value={vowelInput}
				placeholder="Enter text..."
				class="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
				disabled={vowelStatus === 'running'}
			/>
			<button
				onclick={() => vowelCounter.start({ yourName: vowelInput })}
				disabled={vowelStatus === 'running'}
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
			>
				{vowelStatus === 'running' ? 'Running...' : 'Start'}
			</button>
			<button
				onclick={() => vowelCounter.stop()}
				disabled={vowelStatus !== 'running'}
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
			>
				Stop
			</button>
		</div>

		<div class="text-sm">
			Status: <span class="rounded bg-neutral-800 px-2 py-1">{vowelStatus}</span>
			Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{vowelChunks.length}</span>
		</div>

		{#if vowelError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{vowelError}</div>
		{/if}

		{#if vowelChunks.length > 0}
			<div class="grid grid-cols-8 gap-2">
				{#each vowelChunks as chunk}
					<div
						class="rounded p-2 text-center text-sm"
						class:bg-green-900={chunk.isVowel}
						class:bg-neutral-700={!chunk.isVowel}
					>
						{chunk.letter}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Question Asker Test (AI SDK with Tools) -->
	<div class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<h2 class="text-xl font-semibold">Question Asker Test (AI SDK + Tools)</h2>
		<p class="text-sm text-neutral-400">AI SDK integration with tool support</p>

		<div class="flex gap-2">
			<input
				bind:value={qaInput}
				placeholder="Ask a question..."
				class="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
				disabled={qaStatus === 'running'}
			/>
			<button
				onclick={() => questionAsker.start({ prompt: qaInput })}
				disabled={qaStatus === 'running'}
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
			>
				{qaStatus === 'running' ? 'Running...' : 'Ask'}
			</button>
			<button
				onclick={() => questionAsker.stop()}
				disabled={qaStatus !== 'running'}
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
			>
				Stop
			</button>
		</div>

		<div class="text-sm">
			Status: <span class="rounded bg-neutral-800 px-2 py-1">{qaStatus}</span>
			Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{qaChunks.length}</span>
		</div>

		{#if qaError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{qaError}</div>
		{/if}

		{#if qaChunks.length > 0}
			<div class="max-h-96 space-y-2 overflow-y-auto rounded bg-neutral-800 p-3">
				{#each qaChunks as chunk}
					<div class="text-sm">
						{#if chunk.type === 'text-delta'}
							<span>{chunk.text}</span>
						{:else if chunk.type === 'tool-call'}
							<div class="rounded bg-blue-900/30 p-2">
								🔧 Tool Call: {chunk.toolName}
							</div>
						{:else if chunk.type === 'tool-result'}
							<div class="rounded bg-green-900/30 p-2">
								✅ Tool Result: {JSON.stringify(chunk.output)}
							</div>
						{:else if chunk.type === 'tool'}
							<div class="rounded bg-purple-900/30 p-2">
								🔨 {chunk.toolName}: {JSON.stringify(chunk.output || chunk.input)}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Simple Chat Test -->
	<div class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<h2 class="text-xl font-semibold">Simple Chat Test</h2>
		<p class="text-sm text-neutral-400">Text-only AI SDK streaming with pipeTextStream</p>

		<div class="flex gap-2">
			<input
				bind:value={chatInput}
				placeholder="Send a message..."
				class="flex-1 rounded border border-neutral-700 bg-neutral-800 px-3 py-2"
				disabled={chatStatus === 'running'}
			/>
			<button
				onclick={() => simpleChat.start({ message: chatInput })}
				disabled={chatStatus === 'running'}
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
			>
				{chatStatus === 'running' ? 'Running...' : 'Send'}
			</button>
			<button
				onclick={() => simpleChat.stop()}
				disabled={chatStatus !== 'running'}
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
			>
				Stop
			</button>
		</div>

		<div class="text-sm">
			Status: <span class="rounded bg-neutral-800 px-2 py-1">{chatStatus}</span>
		</div>

		{#if chatError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{chatError}</div>
		{/if}

		{#if chatText}
			<div class="rounded bg-neutral-800 p-3">
				<p class="whitespace-pre-wrap">{chatText}</p>
			</div>
		{/if}
	</div>

	<!-- Resumable Stream Test -->
	<div class="space-y-3 rounded-lg border border-neutral-700 bg-neutral-900 p-4">
		<h2 class="text-xl font-semibold">In-Memory Storage Test</h2>
		<p class="text-sm text-neutral-400">
			Stream with in-memory storage - chunks persist across the session. Check browser console for
			storage logs!
		</p>
		<div class="space-y-2 rounded border border-blue-800 bg-blue-900/20 p-2 text-xs">
			<div>
				<strong>Demo:</strong> Click "Stop" mid-stream, then "Start" again to see resumption in action.
			</div>
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={resumableUseStableId} class="rounded" />
				<span>Use stable runId (enables resumption)</span>
			</label>
			{#if resumableUseStableId}
				<input
					bind:value={resumableStableId}
					placeholder="Stable runId..."
					class="w-full rounded border border-blue-700 bg-blue-950 px-2 py-1 font-mono text-xs"
				/>
			{/if}
			<label class="flex items-center gap-2">
				<input type="checkbox" bind:checked={resumableKeepOldChunks} class="rounded" />
				<span>Keep old chunks on resume (visualize history)</span>
			</label>
		</div>

		<div class="flex gap-2">
			<button
				onclick={() => {
					const runId = resumableUseStableId ? resumableStableId : undefined;
					resumableStream.start({ count: 40 }, { runId });
				}}
				disabled={resumableStatus === 'running'}
				class="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
			>
				{resumableStatus === 'running' ? 'Running...' : 'Start'}
			</button>
			<button
				onclick={() => resumableStream.stop()}
				disabled={resumableStatus !== 'running'}
				class="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50"
			>
				Stop
			</button>
			<button
				onclick={() => {
					resumableChunks = [];
					resumableStatus = 'idle';
					resumableError = null;
				}}
				disabled={resumableStatus === 'running'}
				class="rounded bg-neutral-600 px-4 py-2 text-white disabled:opacity-50"
			>
				Clear
			</button>
		</div>

		<div class="space-y-1 text-sm">
			<div>
				Status: <span class="rounded bg-neutral-800 px-2 py-1">{resumableStatus}</span>
				Chunks: <span class="rounded bg-neutral-800 px-2 py-1">{resumableChunks.length}</span>
			</div>
			{#if resumableRunId}
				<div class="font-mono text-xs text-neutral-500">
					runId: {resumableRunId.slice(0, 8)}...
				</div>
			{/if}
		</div>

		{#if resumableError}
			<div class="rounded bg-red-900/30 p-2 text-red-200">{resumableError}</div>
		{/if}

		{#if resumableChunks.length > 0}
			<div class="mb-2 flex items-center gap-4 text-xs">
				<div class="flex items-center gap-1">
					<div class="h-3 w-3 rounded bg-neutral-700"></div>
					<span>Old chunks</span>
				</div>
				<div class="flex items-center gap-1">
					<div class="h-3 w-3 rounded bg-green-700"></div>
					<span>New chunks (this session)</span>
				</div>
			</div>
			<div class="grid grid-cols-5 gap-2">
				{#each resumableChunks as item}
					<div
						class="rounded p-2 text-center text-sm {item.isNew
							? 'bg-green-700'
							: 'bg-neutral-700 opacity-60'}"
					>
						{item.chunk.index}: {item.chunk.data}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Feature Checklist -->
	<div class="rounded-lg border border-green-700 bg-green-900/20 p-4">
		<h2 class="mb-3 text-xl font-semibold text-green-400">✅ V2.5 Feature Parity Checklist</h2>
		<ul class="space-y-1 text-sm text-neutral-300">
			<li>✅ Custom streams with zod validation (vowelCounter)</li>
			<li>✅ AI SDK integration with tools (questionAsker)</li>
			<li>✅ Access to meta.event for framework data</li>
			<li>✅ runId tracking for each execution</li>
			<li>✅ abortSignal support for cancellation</li>
			<li>✅ Storage provider interface</li>
			<li class="mt-2 font-semibold text-green-400">Plus v2.5 exclusive features:</li>
			<li>✅ Plugin system with scopes</li>
			<li>✅ beforeRun/afterRun hooks</li>
			<li>✅ Throttling support</li>
			<li>✅ Client retry logic</li>
			<li>✅ CORS configuration</li>
			<li>✅ Heartbeat support</li>
			<li>✅ Selective plugin usage</li>
		</ul>
	</div>
</div>
