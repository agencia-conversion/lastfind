/**
 * The rate-limit bucket of a client address: an IPv4 address as it is, an IPv6 address by its /64 (one subscriber gets a
 * whole /64, so counting each address would give one client billions of buckets). An IPv4-mapped IPv6 address counts
 * as its IPv4 address. Anything else is returned unchanged.
 */
export function addressBucket(address: string | null | undefined): string | null {
  if (!address) return null;
  if (!address.includes(':')) return address;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1];
  const [head, tail] = address.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16)).join(':')}::/64`;
}
