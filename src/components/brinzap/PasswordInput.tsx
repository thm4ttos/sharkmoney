import { useState, type InputHTMLAttributes } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  value: string;
  onValueChange: (v: string) => void;
  showIcon?: boolean;
};

export function PasswordInput({ value, onValueChange, showIcon = true, className, ...rest }: Props) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative mt-1">
      {showIcon && (
        <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      )}
      <input
        {...rest}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={
          className ??
          `w-full bg-input rounded-xl ${showIcon ? "pl-9" : "pl-3"} pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-smooth`
        }
      />
      <button
        type="button"
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-smooth"
        tabIndex={-1}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; color: string } {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const s = Math.min(score, 4) as 0 | 1 | 2 | 3 | 4;
  const map = [
    { label: "Muito fraca", color: "bg-destructive" },
    { label: "Fraca", color: "bg-destructive" },
    { label: "Média", color: "bg-yellow-500" },
    { label: "Boa", color: "bg-primary" },
    { label: "Forte", color: "bg-accent" },
  ];
  return { score: s, ...map[s] };
}

export function PasswordStrengthMeter({ value }: { value: string }) {
  const { score, label, color } = passwordStrength(value);
  if (!value) return null;
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-smooth ${i < score ? color : "bg-muted/40"}`}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">Força: <span className="text-foreground">{label}</span></p>
    </div>
  );
}
