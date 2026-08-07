import { cn } from "@/lib/utils";

// Antes apontava pra um asset hospedado no Lovable (/__l5e/assets-v1/...),
// que só existe na infraestrutura deles — 404 em qualquer outro deploy.
const logoUrl = "/favicon.png";

type AppLogoProps = {
  className?: string;
  /** Rendered size in px (square). Defaults to 40. */
  size?: number;
};

/**
 * Single source of truth for the Abio brand mark.
 * Never render the words "Abio" next to it — the logo already contains the brand.
 */
export function AppLogo({ className, size = 40 }: AppLogoProps) {
  return (
    <img
      src={logoUrl}
      alt="Abio"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export default AppLogo;
