import type { RequestEvent } from '@sveltejs/kit';
import type {
	BaseStreamContext,
	PluginContext,
	PluginDescriptor,
	RiverPluginReturn,
	StreamInfo,
	StreamLifecycleEndEvent,
	StreamRunStatus,
	StreamRunner
} from '../../types.js';

class PluginManagerImpl implements PluginManager {
	private readonly globalPlugins: RiverPluginReturn<any>[];
	private readonly streamPlugins: RiverPluginReturn<any>[];
	private readonly streamPluginMap: Map<string, RiverPluginReturn<any>>;

	constructor(private readonly plugins: RiverPluginReturn<any>[]) {
		this.globalPlugins = plugins.filter((p) => p.scope === 'global');
		this.streamPlugins = plugins.filter((p) => p.scope === 'stream');
		this.streamPluginMap = new Map(this.streamPlugins.map((p) => [p.id, p]));
	}

	applyRunnerWrappers<I, C>(
		runner: StreamRunner<I, C, any>,
		usePlugins?: readonly string[]
	): StreamRunner<I, C, any> {
		let wrapped = runner;

		for (const plugin of this.globalPlugins) {
			if (plugin.wrapRunner) {
				wrapped = plugin.wrapRunner(wrapped);
			}
		}

		if (usePlugins) {
			for (const pluginId of usePlugins) {
				const plugin = this.streamPluginMap.get(pluginId);
				if (plugin?.wrapRunner) {
					wrapped = plugin.wrapRunner(wrapped);
				}
			}
		}

		return wrapped;
	}

	buildExtendedContext(
		meta: BaseStreamContext,
		usePlugins?: readonly string[]
	): Record<string, unknown> {
		let extendedContext: Record<string, unknown> = {};

		for (const plugin of this.globalPlugins) {
			if (plugin.extendRunnerContext) {
				extendedContext = { ...extendedContext, ...plugin.extendRunnerContext(meta) };
			}
		}

		if (usePlugins && usePlugins.length > 0) {
			for (const pluginId of usePlugins) {
				const plugin = this.streamPluginMap.get(pluginId);
				if (plugin?.extendRunnerContext) {
					extendedContext = { ...extendedContext, ...plugin.extendRunnerContext(meta) };
				}
			}
		}

		return extendedContext;
	}

	async notifyRequest(event: RequestEvent) {
		for (const plugin of this.plugins) {
			await plugin.onRequest?.(event);
		}
	}

	async notifyStreamInfo(info: StreamInfo, streamName: string) {
		for (const plugin of this.plugins) {
			await plugin.onStreamInfo?.(info, streamName);
		}
	}

	processChunk(chunk: unknown, streamName: string) {
		let current = chunk;

		for (const plugin of this.plugins) {
			const transformed = plugin.transformChunk?.(current, streamName);
			if (transformed !== undefined) {
				current = transformed;
			}
			const observed = plugin.onChunk?.(current, streamName);
			if (observed !== undefined) {
				current = observed;
			}
		}

		return current;
	}

	async notifyStreamFinished(
		status: StreamRunStatus,
		endEvent: StreamLifecycleEndEvent,
		streamName: string
	) {
		for (const plugin of this.plugins) {
			await plugin.onComplete?.(status, streamName);
			await plugin.onStreamEnd?.(endEvent, streamName);
		}
	}

	async notifyHeartbeat(streamName: string) {
		for (const plugin of this.plugins) {
			try {
				await plugin.onHeartbeat?.(streamName);
			} catch (error) {
				console.error(
					`Heartbeat hook failed for plugin "${plugin.id}" on stream "${streamName}":`,
					error
				);
			}
		}
	}
}

export interface PluginManager {
	applyRunnerWrappers<I, C>(
		runner: StreamRunner<I, C, any>,
		usePlugins?: readonly string[]
	): StreamRunner<I, C, any>;
	buildExtendedContext(
		meta: BaseStreamContext,
		usePlugins?: readonly string[]
	): Record<string, unknown>;
	notifyRequest(event: RequestEvent): Promise<void>;
	notifyStreamInfo(info: StreamInfo, streamName: string): Promise<void>;
	processChunk(chunk: unknown, streamName: string): unknown;
	notifyStreamFinished(
		status: StreamRunStatus,
		endEvent: StreamLifecycleEndEvent,
		streamName: string
	): Promise<void>;
	notifyHeartbeat(streamName: string): Promise<void>;
}

export function createPluginManager(
	descriptors: readonly PluginDescriptor<any, any, any, any>[],
	actualConfig: any,
	ctx: PluginContext
): PluginManager {
	const plugins: RiverPluginReturn<any>[] = [];

	for (const descriptor of descriptors) {
		const providedConfig = actualConfig[descriptor.id];
		const resolvedConfig =
			providedConfig !== undefined
				? providedConfig
				: descriptor.defaultConfig
					? descriptor.defaultConfig()
					: undefined;

		if (resolvedConfig === undefined && providedConfig === undefined && !descriptor.defaultConfig) {
			console.warn(
				`No configuration supplied for plugin "${descriptor.id}". Passing undefined to the plugin factory.`
			);
		}

		const pluginFactory = descriptor.createPlugin(resolvedConfig as any);
		const instance = pluginFactory(ctx);
		plugins.push(instance);
		instance.onInit?.();
	}

	return new PluginManagerImpl(plugins);
}
