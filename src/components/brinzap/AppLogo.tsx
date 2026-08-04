import logoAsset from "@/assets/shark-money-logo.png.asset.json";
import { cn } from "@/lib/utils";

type AppLogoProps = {
  className?: string;
  /** Rendered size in px (square). Defaults to 40. */
  size?: number;
};

/**
 * Single source of truth for the Shark Money brand mark.
 * Never render the words "Shark Money" next to it — the logo already contains the brand.
 */
export function AppLogo({ className, size = 40 }: AppLogoProps) {
  return (
    <img
      src={logoAsset.url}
      alt="Shark Money"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export default AppLogo;
