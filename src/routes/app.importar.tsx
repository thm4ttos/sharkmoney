import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { previewImport, previewImportStructured, commitImport, listImportBatches, undoImportBatch } from "@/lib/import-history.functions";
import { parseXlsxBuffer, parseCsvText, summarize, type ParsedRow } from "@/lib/spreadsheet-parser";
import { formatBRL } from "@/lib/user-mock";
import { formatDayMonthSP } from "@/lib/datetime";
import { Upload, FileText, Loader2, Sparkles, Check, X, Undo2, ClipboardPaste, History, Image as ImageIcon, Bot, Send } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/importar")({ component: ImportPage });

const CATEGORIES = [
  "Moradia", "Alimentação", "Transporte", "Saúde", "Educação",
  "Lazer", "Pessoal", "Investimentos", "Vida Espiritual",
  "Empresa e Autônomo", "Outros", "Receita",
];

type PreviewItem = {
  date: string; time?: string | null; amount: number;
  kind: "income" | "expense"; category: string; description: string;
  notes?: string | null; duplicate?: boolean; _idx: number; _keep?: boolean;
};

type ChatMsg = { role: "bot" | "user"; content: React.ReactNode; id: string };

const STAGES = [
  "📄 Arquivo recebido.",
  "🔍 Identificando formato...",
  "🤖 Extraindo lançamentos...",
  "📊 Processando dados...",
  "🗂️ Identificando categorias...",
  "🧮 Conferindo valores...",
  "💾 Preparando registros...",
  "✨ Quase lá...",
];

function friendlyError(raw: unknown): string {
  const msg = String((raw as any)?.message ?? raw ?? "");
  // Bloqueia mensagens técnicas
  if (!msg || /524|5\d\d|timeout|abort|stack|exception|error code|fetch failed|network|econn|enotfound/i.test(msg)) {
    return "A IA está demorando mais que o normal. Tente novamente em instantes ou envie um arquivo menor.";
  }
  if (/200000 character|too large|max.*character/i.test(msg)) {
    return "Arquivo muito grande. Estamos dividindo em partes — tente novamente.";
  }
  // Mensagens amigáveis já vindas do servidor
  if (/IA|créditos|arquivo|conteúdo|instantes/i.test(msg)) return msg;
  return "Não consegui processar agora. Tente novamente em instantes.";
}

function ImportPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const previewFn = useServerFn(previewImport);
  const previewStructuredFn = useServerFn(previewImportStructured);
  const commitFn = useServerFn(commitImport);
  const undoFn = useServerFn(undoImportBatch);
  const listFn = useServerFn(listImportBatches);
  const [expectedTotals, setExpectedTotals] = useState<{ total: number; income: number; expense: number } | null>(null);

  const [text, setText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<string>("text");
  const [items, setItems] = useState<PreviewItem[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [stageIdx, setStageIdx] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ imported: number; skipped: number } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);

  const { data: batches = [] } = useQuery<any[]>({
    queryKey: ["import-batches"],
    queryFn: () => listFn() as any,
  });

  const undoM = useMutation({
    mutationFn: (id: string) => undoFn({ data: { batchId: id } }) as any,
    onSuccess: (res: any) => {
      toast.success(`↩️ ${res.removed} lançamentos removidos.`);
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
      qc.invalidateQueries({ queryKey: ["home-stats"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Falha ao desfazer."),
  });

  // Auto-scroll chat
  useEffect(() => {
    if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
  }, [chatMsgs, analyzing]);

  // Animate stages while analyzing
  useEffect(() => {
    if (!analyzing) return;
    setStageIdx(0);
    const t = setInterval(() => {
      setStageIdx(i => (i < STAGES.length - 1 ? i + 1 : i));
    }, 900);
    return () => clearInterval(t);
  }, [analyzing]);

  function pushBot(content: React.ReactNode) {
    setChatMsgs(prev => [...prev, { role: "bot", content, id: crypto.randomUUID() }]);
  }
  function pushUser(content: React.ReactNode) {
    setChatMsgs(prev => [...prev, { role: "user", content, id: crypto.randomUUID() }]);
  }

  async function handleFileSelected(file: File) {
    setPendingFile(file);
    setText("");
    setItems(null);
    setStats(null);
    setImported(null);
    const lower = file.name.toLowerCase();
    if (lower.match(/\.(jpg|jpeg|png|webp)$/)) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  }

  type FilePayload =
    | { mode: "structured"; rows: ParsedRow[]; fileName: string }
    | { mode: "ai"; payload: any };

  async function readFileForPreview(file: File): Promise<FilePayload> {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      setSourceKind("excel");
      const buf = await file.arrayBuffer();
      const rows = parseXlsxBuffer(buf);
      return { mode: "structured", rows, fileName: file.name };
    }
    if (lower.endsWith(".csv")) {
      setSourceKind("csv");
      const txt = await file.text();
      const rows = parseCsvText(txt);
      return { mode: "structured", rows, fileName: file.name };
    }
    if (lower.endsWith(".txt") || lower.endsWith(".ofx") || lower.endsWith(".qif")) {
      setSourceKind(lower.endsWith(".ofx") ? "ofx" : lower.endsWith(".qif") ? "qif" : "txt");
      const txt = await file.text();
      // Try structured first (extracts many .txt exports); fall back to AI if nothing found.
      const rows = parseCsvText(txt);
      if (rows.length) return { mode: "structured", rows, fileName: file.name };
      return { mode: "ai", payload: { text: txt, fileName: file.name } };
    }
    if (lower.endsWith(".pdf")) {
      setSourceKind("pdf");
      const buf = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      return { mode: "ai", payload: { pdfBase64: b64, pdfMime: "application/pdf", fileName: file.name } };
    }
    if (lower.match(/\.(jpg|jpeg|png|webp)$/)) {
      setSourceKind("image");
      const buf = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const mime = lower.endsWith(".png") ? "image/png"
        : lower.endsWith(".webp") ? "image/webp"
        : "image/jpeg";
      return { mode: "ai", payload: { imageBase64: b64, imageMime: mime, fileName: file.name } };
    }
    setSourceKind("other");
    const txt = await file.text();
    return { mode: "ai", payload: { text: txt, fileName: file.name } };
  }

  async function runPreviewChunked(payload: any): Promise<any> {
    // Chunk only text-based payloads. PDFs/images go as-is.
    const CHUNK_LIMIT = 60_000; // menor = menos risco de timeout no gateway
    if (payload.text && typeof payload.text === "string" && payload.text.length > CHUNK_LIMIT) {
      const lines = payload.text.split("\n");
      const chunks: string[] = [];
      let cur = "";
      for (const line of lines) {
        if (cur.length + line.length + 1 > CHUNK_LIMIT && cur.length) {
          chunks.push(cur);
          cur = "";
        }
        // Handle a single line longer than the limit by hard-splitting
        if (line.length > CHUNK_LIMIT) {
          for (let i = 0; i < line.length; i += CHUNK_LIMIT) {
            chunks.push(line.slice(i, i + CHUNK_LIMIT));
          }
          continue;
        }
        cur += (cur ? "\n" : "") + line;
      }
      if (cur) chunks.push(cur);

      const allItems: any[] = [];
      let income = 0, expense = 0, duplicates = 0, uncategorized = 0;
      let periodFrom: string | null = null, periodTo: string | null = null;
      setChunkProgress({ current: 0, total: chunks.length });
      for (let i = 0; i < chunks.length; i++) {
        setChunkProgress({ current: i + 1, total: chunks.length });
        // Retry por chunk (até 3 tentativas), retomando do último ponto processado
        let res: any = null;
        let attempt = 0;
        while (attempt < 3) {
          try {
            res = await previewFn({ data: { ...payload, text: chunks[i] } });
            break;
          } catch (err) {
            attempt++;
            if (attempt >= 3) throw err;
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
        for (const it of (res?.items ?? [])) allItems.push(it);
        const s = res?.stats ?? {};
        income += Number(s.income ?? 0);
        expense += Number(s.expense ?? 0);
        duplicates += Number(s.duplicates ?? 0);
        uncategorized += Number(s.uncategorized ?? 0);
        if (s.period?.from && (!periodFrom || s.period.from < periodFrom)) periodFrom = s.period.from;
        if (s.period?.to && (!periodTo || s.period.to > periodTo)) periodTo = s.period.to;
      }
      setChunkProgress(null);

      // Deduplicate merged items (same date+amount+kind+description)
      const seen = new Set<string>();
      const unique: any[] = [];
      for (const it of allItems) {
        const k = `${it.date}|${it.amount}|${it.kind}|${String(it.description ?? "").toLowerCase().trim()}`;
        if (seen.has(k)) continue;
        seen.add(k);
        unique.push(it);
      }
      // Chronological order
      unique.sort((a, b) => {
        const da = `${a.date}T${a.time ?? "00:00"}`;
        const db = `${b.date}T${b.time ?? "00:00"}`;
        return da.localeCompare(db);
      });
      // Recompute totals from unique items (avoid double counting across chunks)
      let uIncome = 0, uExpense = 0, uDup = 0, uUncat = 0;
      const reIndexed = unique.map((it, idx) => {
        if (it.kind === "income") uIncome += Number(it.amount); else uExpense += Number(it.amount);
        if (it.duplicate) uDup++;
        if (it.category === "Outros") uUncat++;
        return { ...it, _idx: idx };
      });
      return {
        items: reIndexed,
        stats: {
          total: reIndexed.length,
          income: uIncome,
          expense: uExpense,
          duplicates: uDup,
          uncategorized: uUncat,
          period: periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null,
        },
      };
    }
    // Non-text (PDF/imagem): server já faz retry 3x com timeout controlado
    return await previewFn({ data: payload });
  }

  async function startAnalysis(source: "file" | "text") {
    setChatMsgs([]);
    setImported(null);
    setAwaitingConfirm(false);
    setChatOpen(true);
    setAnalyzing(true);
    setChunkProgress(null);
    pushBot(<>📄 Arquivo recebido. 🔍 Identificando formato…</>);
    try {
      let res: any;
      if (source === "file") {
        if (!pendingFile) throw new Error("Selecione um arquivo primeiro.");
        const parsed = await readFileForPreview(pendingFile);
        if (parsed.mode === "structured") {
          if (!parsed.rows.length) {
            setAnalyzing(false);
            pushBot(<>Não consegui identificar colunas de data/valor nesta planilha. Verifique se o arquivo tem cabeçalhos (Data, Valor, Descrição…).</>);
            return;
          }
          const s = summarize(parsed.rows);
          setExpectedTotals({ total: s.total, income: s.income, expense: s.expense });
          res = await previewStructuredFn({ data: { fileName: parsed.fileName, items: parsed.rows } });
        } else {
          setExpectedTotals(null);
          res = await runPreviewChunked(parsed.payload);
        }
      } else {
        if (!text.trim()) throw new Error("Cole algum conteúdo primeiro.");
        setSourceKind("paste");
        setExpectedTotals(null);
        res = await runPreviewChunked({ text, fileName: "colado.txt" });
      }
      const withKeep: PreviewItem[] = (res.items ?? []).map((i: PreviewItem) => ({ ...i, _keep: true }));
      setItems(withKeep);
      setStats(res.stats);
      setAnalyzing(false);
      setChunkProgress(null);

      if (!withKeep.length) {
        pushBot(<>Não consegui identificar lançamentos nesse conteúdo. Você pode tentar outro arquivo ou colar o texto diretamente.</>);
        return;
      }

      const income = res.stats.income as number;
      const expense = res.stats.expense as number;
      const period = res.stats.period;
      const dup = res.stats.duplicates as number;
      const uncat = res.stats.uncategorized as number;
      const inst = (res.stats.installments as number) ?? 0;
      const rec = (res.stats.recurring as number) ?? 0;
      const receitas = withKeep.filter(i => i.kind === "income").length;
      const desp = withKeep.filter(i => i.kind === "expense").length;

      pushBot(
        <div className="space-y-2">
          <p className="font-medium">Analisei seu arquivo com sucesso ✨</p>
          <p>Encontrei:</p>
          <ul className="space-y-0.5 text-sm">
            <li>• <b>{desp}</b> despesas</li>
            <li>• <b>{receitas}</b> receitas</li>
            {inst > 0 && <li>• <b>{inst}</b> parcelamentos identificados</li>}
            {rec > 0 && <li>• <b>{rec}</b> contas fixas / recorrentes</li>}
            {dup > 0 && <li>• <b>{dup}</b> possíveis duplicados (serão ignorados)</li>}
            {uncat > 0 && <li>• <b>{uncat}</b> sem categoria clara (marcados como Outros)</li>}
          </ul>
          {period && (
            <p className="text-sm">Período: <b>{formatDayMonthSP(period.from)} a {formatDayMonthSP(period.to)}</b></p>
          )}
        </div>
      );

      pushBot(
        <div className="space-y-2">
          <p>Posso importar:</p>
          <ul className="space-y-0.5 text-sm">
            <li>✅ <b>{withKeep.length}</b> lançamentos</li>
            <li>Receitas: <b className="text-emerald-400">{formatBRL(income)}</b></li>
            <li>Despesas: <b className="text-rose-400">{formatBRL(expense)}</b></li>
          </ul>
          <p className="pt-1">Deseja continuar?</p>
        </div>
      );
      setAwaitingConfirm(true);
    } catch (e: any) {
      setAnalyzing(false);
      setChunkProgress(null);
      pushBot(<span className="text-rose-400">⚠️ {friendlyError(e)}</span>);
    }
  }

  async function confirmImport() {
    if (!items) return;
    setImporting(true);
    setAwaitingConfirm(false);
    pushUser(<>Importar agora</>);
    try {
      const payload = items.filter(i => i._keep).map(({ _idx, _keep, ...rest }) => rest);
      const res: any = await commitFn({
        data: {
          fileName: pendingFile?.name ?? undefined,
          sourceKind,
          duplicatePolicy: "skip",
          items: payload,
          expected: expectedTotals ?? undefined,
        },
      });
      setImported({ imported: res.imported, skipped: res.skipped });
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats-v2"] });
      qc.invalidateQueries({ queryKey: ["home-stats"] });
      qc.invalidateQueries({ queryKey: ["monthly-summary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      const period = stats?.period;
      const inst = (stats?.installments as number) ?? 0;
      const rec = (stats?.recurring as number) ?? 0;
      const catCount = new Set(items.filter(i => i._keep).map(i => i.category)).size;
      pushBot(
        <div className="space-y-1.5">
          <p className="font-medium">✅ Importação concluída</p>
          <ul className="space-y-0.5 text-sm">
            <li>• Registros importados: <b>{res.imported}</b>{res.skipped ? ` (${res.skipped} duplicados ignorados)` : ""}</li>
            {period && <li>• Período: <b>{formatDayMonthSP(period.from)} a {formatDayMonthSP(period.to)}</b></li>}
            <li>• Receitas: <b className="text-emerald-400">{formatBRL(res.totals?.income ?? stats?.income ?? 0)}</b></li>
            <li>• Despesas: <b className="text-rose-400">{formatBRL(res.totals?.expense ?? stats?.expense ?? 0)}</b></li>
            <li>• Saldo: <b>{formatBRL((res.totals?.income ?? stats?.income ?? 0) - (res.totals?.expense ?? stats?.expense ?? 0))}</b></li>
            {inst > 0 && <li>• Parcelamentos reconhecidos: <b>{inst}</b></li>}
            {rec > 0 && <li>• Contas recorrentes: <b>{rec}</b></li>}
            <li>• Categorias: <b>{catCount}</b></li>
          </ul>
          <p className="text-xs text-muted-foreground pt-1">Tudo conferido com sucesso. Gráficos e relatórios já foram atualizados.</p>
        </div>
      );
    } catch (e: any) {
      pushBot(<span className="text-rose-400">⚠️ {friendlyError(e)}</span>);
    } finally {
      setImporting(false);
    }
  }

  function cancelChat() {
    setChatOpen(false);
    setAnalyzing(false);
    setChatMsgs([]);
    setAwaitingConfirm(false);
  }

  function submitChatInput() {
    const t = chatInput.trim();
    if (!t) return;
    pushUser(<>{t}</>);
    setChatInput("");
    const low = t.toLowerCase();
    if (awaitingConfirm && /^(sim|confirmar|importar|pode|ok|continuar)/i.test(low)) {
      confirmImport();
      return;
    }
    if (awaitingConfirm && /^(nao|não|cancelar|para|pare)/i.test(low)) {
      cancelChat();
      return;
    }
    pushBot(<>Entendi. Quando quiser, é só clicar em <b>Importar agora</b> para concluir, ou <b>Cancelar</b>.</>);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-primary flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> IA de importação</p>
        <h1 className="font-display text-3xl mt-1">Importar Histórico</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Migre planilhas, PDFs, exportações, prints ou anotações para o Abio. A IA interpreta datas, valores, categorias e tudo mais automaticamente.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Upload */}
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg">Enviar arquivo / imagem</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Aceita <b>.xlsx</b>, <b>.xls</b>, <b>.csv</b>, <b>.txt</b>, <b>.pdf</b>, <b>.ofx</b>, <b>.qif</b> e imagens <b>.jpg</b>, <b>.jpeg</b>, <b>.png</b>, <b>.webp</b>. Sem limite de registros — arquivos grandes são processados em partes.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt,.pdf,.ofx,.qif,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,text/plain,image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); e.target.value = ""; }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-border bg-background/40 hover:border-primary/50 transition-smooth p-6 text-sm flex flex-col items-center justify-center gap-2"
          >
            {pendingFile ? (
              imagePreview ? (
                <>
                  <img src={imagePreview} alt="" className="max-h-32 rounded-lg object-contain" />
                  <span className="text-xs text-muted-foreground truncate max-w-full">{pendingFile.name}</span>
                </>
              ) : (
                <>
                  <FileText className="h-6 w-6 text-primary" />
                  <span className="text-xs text-muted-foreground truncate max-w-full">{pendingFile.name}</span>
                  <span className="text-[11px] text-muted-foreground">Clique para trocar</span>
                </>
              )
            ) : (
              <>
                <div className="flex gap-2 text-primary">
                  <FileText className="h-6 w-6" />
                  <ImageIcon className="h-6 w-6" />
                </div>
                <span>Clique para selecionar um arquivo ou imagem</span>
              </>
            )}
          </button>
          {pendingFile && (
            <button
              onClick={() => startAnalysis("file")}
              className="w-full rounded-xl bg-gradient-brand text-primary-foreground px-4 py-3 text-sm font-semibold glow-neon inline-flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2"
            >
              <Bot className="h-4 w-4" /> 🤖 Importar e analisar com IA
            </button>
          )}
        </div>

        {/* Paste */}
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg">Colar texto</h2>
          </div>
          <p className="text-xs text-muted-foreground">Cole lançamentos livres. A IA entende qualquer formato.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"Ex.:\n01/07 Mercado 250\n02/07 Gasolina 120\n03/07 Salário 3200"}
            className="w-full bg-input rounded-xl px-3 py-2.5 text-sm font-mono"
          />
          <button
            onClick={() => startAnalysis("text")}
            disabled={!text.trim()}
            className="w-full rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm font-medium glow-neon disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            <Bot className="h-4 w-4" /> 🤖 Importar e analisar com IA
          </button>
        </div>
      </div>

      {/* History */}
      <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <History className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg">Histórico de importações</h2>
        </div>
        {!batches.length && <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>}
        <div className="divide-y divide-border">
          {batches.map((b: any) => (
            <div key={b.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{b.file_name ?? "Colado"} <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-1">{b.source_kind}</span></p>
                <p className="text-xs text-muted-foreground">
                  {new Date(b.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {b.imported_count} importados · {b.skipped_count} ignorados · {b.error_count} erros
                  {b.status === "reverted" && <span className="ml-2 text-rose-400">(desfeito)</span>}
                </p>
              </div>
              {b.status !== "reverted" && b.imported_count > 0 && (
                <button
                  onClick={() => { if (confirm("Remover todos os lançamentos importados neste lote?")) undoM.mutate(b.id); }}
                  disabled={undoM.isPending}
                  className="text-xs rounded-lg border border-border px-3 py-1.5 inline-flex items-center gap-1.5 hover:border-destructive/50 hover:text-destructive"
                >
                  <Undo2 className="h-3 w-3" /> Desfazer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat modal */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in"
          onClick={() => { if (!importing && !analyzing) cancelChat(); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg h-[85vh] sm:h-[600px] flex flex-col rounded-t-3xl sm:rounded-3xl border border-primary/30 bg-card shadow-2xl glow-neon animate-in fade-in zoom-in-95 slide-in-from-bottom-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-brand-soft rounded-t-3xl">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-gradient-brand grid place-items-center glow-neon">
                  <Bot className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-display leading-none">Abio IA</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Assistente de importação</p>
                </div>
              </div>
              <button
                onClick={cancelChat}
                disabled={importing}
                className="h-8 w-8 grid place-items-center rounded-full hover:bg-background/40 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMsgs.map(m => (
                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-1`}>
                  <div className={[
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-gradient-brand text-primary-foreground rounded-br-md"
                      : "bg-background/60 border border-border rounded-bl-md",
                  ].join(" ")}>
                    {m.content}
                  </div>
                </div>
              ))}
              {analyzing && (
                <div className="flex justify-start animate-in fade-in">
                  <div className="max-w-[85%] w-full rounded-2xl rounded-bl-md px-3.5 py-3 text-sm bg-background/60 border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="font-medium">
                        {chunkProgress
                          ? `📊 Processando parte ${chunkProgress.current} de ${chunkProgress.total}...`
                          : STAGES[stageIdx]}
                      </span>
                    </div>
                    {chunkProgress && (
                      <div className="mb-2">
                        <div className="h-2 w-full rounded-full bg-background/70 overflow-hidden">
                          <div
                            className="h-full bg-gradient-brand transition-all"
                            style={{ width: `${Math.round((chunkProgress.current / chunkProgress.total) * 100)}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {Math.round((chunkProgress.current / chunkProgress.total) * 100)}% · Parte {chunkProgress.current} de {chunkProgress.total}
                        </p>
                      </div>
                    )}
                    <div className="space-y-1">
                      {STAGES.slice(0, stageIdx + 1).map((s, i) => (
                        <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {i < stageIdx ? <Check className="h-3 w-3 text-emerald-400" /> : <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                          <span>{s}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions / composer */}
            <div className="border-t border-border p-3 space-y-2">
              {imported ? (
                <button
                  onClick={() => { setChatOpen(false); navigate({ to: "/app/dashboard" }); }}
                  className="w-full rounded-xl bg-gradient-brand text-primary-foreground px-4 py-3 text-sm font-semibold glow-neon"
                >
                  Ir para Dashboard →
                </button>
              ) : awaitingConfirm ? (
                <div className="flex gap-2">
                  <button
                    onClick={cancelChat}
                    disabled={importing}
                    className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-background/40 disabled:opacity-60"
                  >Cancelar</button>
                  <button
                    onClick={confirmImport}
                    disabled={importing}
                    className="flex-[2] rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2.5 text-sm font-semibold glow-neon inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Importar agora
                  </button>
                </div>
              ) : (
                <div className="flex gap-2 items-center">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitChatInput(); }}
                    disabled={analyzing || importing}
                    placeholder={analyzing ? "Aguarde a análise…" : "Fale com a IA…"}
                    className="flex-1 bg-input rounded-xl px-3 py-2.5 text-sm disabled:opacity-60"
                  />
                  <button
                    onClick={submitChatInput}
                    disabled={analyzing || importing || !chatInput.trim()}
                    className="h-10 w-10 grid place-items-center rounded-xl bg-gradient-brand text-primary-foreground disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Optional: quick edit preview (kept minimal, hidden unless user needs it) */}
      {items && stats && !chatOpen && !imported && (
        <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-xl p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-display text-lg">Última análise</h2>
              <p className="text-sm text-muted-foreground">{stats.total} lançamentos · Receitas {formatBRL(stats.income)} · Despesas {formatBRL(stats.expense)}</p>
            </div>
            <button
              onClick={() => setChatOpen(true)}
              className="rounded-xl bg-gradient-brand text-primary-foreground px-4 py-2 text-sm font-medium glow-neon inline-flex items-center gap-2"
            >
              <Bot className="h-4 w-4" /> Continuar com a IA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}
