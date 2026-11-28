export async function runWalkthrough(name: string, payload: unknown): Promise<unknown> {
  const response = await fetch('/__standby_demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
