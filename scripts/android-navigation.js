export function resolveAndroidBackAction({ currentRoute, stack, canGoBack, historyLength }) {
  const nextStack = Array.isArray(stack) ? stack.slice() : [];
  while (nextStack.length && nextStack.at(-1) === currentRoute) nextStack.pop();

  const previousRoute = nextStack.at(-1);
  if (previousRoute) {
    nextStack.pop();
    return { type: "route", route: previousRoute, stack: nextStack };
  }
  if (canGoBack && Number(historyLength) > 1) {
    return { type: "history", stack: nextStack };
  }
  return { type: "exit", stack: nextStack };
}

export function resolveAndroidPlayerBackAction({ fullscreen, fallbackFullscreen }) {
  return fullscreen || fallbackFullscreen ? "exit-fullscreen" : "close-player";
}
