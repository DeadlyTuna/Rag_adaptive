// Lets Node run the frontend's TypeScript engine directly: resolves "./types" → "./types.ts".
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(specifier + ".ts", context);
    throw err;
  }
}
