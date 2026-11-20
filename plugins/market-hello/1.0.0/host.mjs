export default function marketHello(ctx) {
  ctx.effect(() => {
    console.info("[market-hello] Hello from the KEM plugin market!");
    return () => console.info("[market-hello] Goodbye!");
  });
}
