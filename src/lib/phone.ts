export function normalizePhone(v: string | null | undefined): string {
  if (!v) return "";
  const digits = String(v).replace(/\D/g, "").replace(/^0+/, "");

  // Z-API envia números brasileiros com DDI (55). No cadastro o usuário pode
  // informar apenas DDD + número, então normalizamos para o mesmo formato.
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
    return `55${digits}`;
  }

  return digits;
}

export function phoneLookupVariants(v: string | null | undefined): string[] {
  const phone = normalizePhone(v);
  const variants = new Set<string>(phone ? [phone] : []);

  // Alguns gateways enviam celular BR sem o nono dígito depois do DDD.
  if (phone.startsWith("55") && phone.length === 13 && phone[4] === "9") {
    variants.add(`${phone.slice(0, 4)}${phone.slice(5)}`);
  }
  if (phone.startsWith("55") && phone.length === 12) {
    variants.add(`${phone.slice(0, 4)}9${phone.slice(4)}`);
  }

  return [...variants];
}

/**
 * Formats a phone number for display, e.g. "5532999311025" → "+55 32 99931-1025".
 * Falls back gracefully for unusual inputs.
 */
export function formatPhoneDisplay(v: string | null | undefined): string {
  const digits = normalizePhone(v);
  if (!digits) return "";
  // Brazilian numbers with DDI
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const cc = digits.slice(0, 2);
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) return `+${cc} ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
    if (rest.length === 8) return `+${cc} ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  // International fallback
  return `+${digits}`;
}
