// Process isolation limits crashes and memory, but is NOT a security sandbox.
// Only administrator-vetted, filesystem-installed code is permitted.
process.once(
  'message',
  async (message: { url: string; event: string; data: unknown; config: unknown }) => {
    try {
      const plugin = (await import(message.url)).default as {
        hooks: { event: string; handler: (data: unknown, config: unknown) => Promise<unknown> }[];
      };
      for (const hook of plugin.hooks.filter((h) => h.event === message.event))
        await hook.handler(message.data, message.config);
      process.send?.({ ok: true });
    } catch {
      process.send?.({ ok: false });
    }
  },
);
