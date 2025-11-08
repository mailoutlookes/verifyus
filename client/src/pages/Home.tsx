import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, CheckCircle2, Loader2, AlertCircle, Mail, Code, RotateCcw, Lock, ChevronDown } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { trpc } from "@/lib/trpc";

type Status = "idle" | "generating" | "connecting" | "monitoring" | "found" | "error";
type EmailType = "outlook" | "hotmail";

export default function Home() {
  const [apiToken, setApiToken] = useState("");
  const [emailType, setEmailType] = useState<EmailType>("outlook");
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);
  
  // Store data for retry
  const [storedAccessToken, setStoredAccessToken] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  const generateEmailMutation = trpc.outlook.generateEmail.useMutation();
  const getAccessTokenMutation = trpc.outlook.getAccessToken.useMutation();
  const monitorInboxMutation = trpc.outlook.monitorInbox.useMutation();
  const retryMonitorInboxMutation = trpc.outlook.retryMonitorInbox.useMutation();
  
  // Email list state
  const [showEmails, setShowEmails] = useState(false);
  const [emails, setEmails] = useState<Array<{id: string; subject: string; from: string; receivedDateTime: string; bodyPreview: string; body: string;}>>([]);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const listEmailsMutation = trpc.outlook.listEmails.useMutation();

  const handleGenerateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedToken = apiToken.trim();
    if (!trimmedToken) {
      setErrorMessage("Por favor, insira um token válido");
      return;
    }

    if (trimmedToken.length < 10) {
      setErrorMessage("Token deve ter pelo menos 10 caracteres");
      return;
    }

    setErrorMessage("");
    setStatus("generating");
    setEmail("");
    setPassword("");
    setVerificationCode("");
    setCanRetry(false);

    try {
      // Step 1: Generate email
      const emailResult = await generateEmailMutation.mutateAsync({ 
        token: trimmedToken,
        type: emailType 
      });
      
      if (!emailResult.success || !emailResult.result || emailResult.result.length === 0) {
        throw new Error(emailResult.message || "Erro ao gerar e-mail. Verifique seu token.");
      }

      const emailData = emailResult.result[0];
      if (!emailData.email || !emailData.refresh_token || !emailData.client_id) {
        throw new Error("Dados incompletos retornados pela API");
      }

      setEmail(emailData.email);
      setPassword(emailData.password || "");

      // Step 2: Get access token
      setStatus("connecting");
      const tokenResult = await getAccessTokenMutation.mutateAsync({
        refreshToken: emailData.refresh_token,
        clientId: emailData.client_id,
      });

      if (!tokenResult.success || !tokenResult.accessToken) {
        throw new Error("Erro ao conectar ao Outlook. Tente novamente.");
      }

      // Store access token for retry
      setStoredAccessToken(tokenResult.accessToken);
      setCanRetry(true);

      // Step 3: Monitor inbox
      setStatus("monitoring");
      const monitorResult = await monitorInboxMutation.mutateAsync({
        accessToken: tokenResult.accessToken,
      });

      if (monitorResult.success && monitorResult.verificationCode) {
        setVerificationCode(monitorResult.verificationCode);
        setStatus("found");
      } else {
        throw new Error(monitorResult.message || "Código de verificação não encontrado. Tente novamente.");
      }
    } catch (error) {
      setStatus("error");
      const errorMsg = error instanceof Error ? error.message : "Erro ao processar solicitação";
      setErrorMessage(errorMsg);
      console.error("Process error:", error);
    }
  };

  const handleRetryMonitor = async () => {
    if (!storedAccessToken) {
      setErrorMessage("Sessão expirada. Gere um novo e-mail.");
      return;
    }

    setErrorMessage("");
    setStatus("monitoring");
    setVerificationCode("");

    try {
      const retryResult = await retryMonitorInboxMutation.mutateAsync({
        accessToken: storedAccessToken,
      });

      if (retryResult.success && retryResult.verificationCode) {
        setVerificationCode(retryResult.verificationCode);
        setStatus("found");
      } else {
        throw new Error(retryResult.message || "Código de verificação não encontrado. Tente novamente.");
      }
    } catch (error) {
      setStatus("error");
      const errorMsg = error instanceof Error ? error.message : "Erro ao tentar novamente";
      setErrorMessage(errorMsg);
      console.error("Retry error:", error);
    }
  };

  const handleReset = () => {
    setApiToken("");
    setStatus("idle");
    setEmail("");
    setPassword("");
    setVerificationCode("");
    setErrorMessage("");
    setStoredAccessToken("");
    setCanRetry(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusMessages: Record<Status, string> = {
    idle: "Pronto para começar",
    generating: "Gerando e-mail...",
    connecting: "Conectando ao Outlook...",
    monitoring: "Aguardando código de verificação...",
    found: "Código encontrado!",
    error: "Erro no processo",
  };

  const statusColors: Record<Status, string> = {
    idle: "bg-slate-100 text-slate-700",
    generating: "bg-blue-100 text-blue-700",
    connecting: "bg-purple-100 text-purple-700",
    monitoring: "bg-amber-100 text-amber-700",
    found: "bg-green-100 text-green-700",
    error: "bg-red-100 text-red-700",
  };

  const emailTypeLabel = emailType === "outlook" ? "Outlook" : "Hotmail";
  const emailTypeColor = emailType === "outlook" ? "bg-blue-50 border-blue-200" : "bg-purple-50 border-purple-200";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-8">
      <ThemeToggle />
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Mail className="w-10 h-10 text-blue-600 mr-3" />
	            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
	              Outlook Email Verifier
	            </h1>
          </div>
	          <p className="text-slate-600 dark:text-slate-400 text-lg">
	            Automatize a geração de e-mails e extração de códigos de verificação
	          </p>
	          <a href="/logs" className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium mt-2 inline-block">
	            Ver Histórico de Logs
	          </a>
        </div>

        {/* Main Card */}
        <Card className="shadow-lg mb-6">
          <CardHeader>
            <CardTitle>Gerar E-mail e Obter Código</CardTitle>
            <CardDescription>
              Escolha o tipo de e-mail e insira seu token da API para começar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Email Type Selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-3">
                Tipo de E-mail
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setEmailType("outlook")}
                  disabled={status !== "idle" && status !== "error"}
                  className={`flex-1 p-4 rounded-lg border-2 font-semibold transition-all ${
                    emailType === "outlook"
                      ? "bg-blue-100 border-blue-400 text-blue-700 shadow-md"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-blue-300"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Mail className="w-5 h-5 inline mr-2" />
                  Outlook
                </button>
                <button
                  type="button"
                  onClick={() => setEmailType("hotmail")}
                  disabled={status !== "idle" && status !== "error"}
                  className={`flex-1 p-4 rounded-lg border-2 font-semibold transition-all ${
                    emailType === "hotmail"
                      ? "bg-purple-100 border-purple-400 text-purple-700 shadow-md"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:border-purple-300"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Mail className="w-5 h-5 inline mr-2" />
                  Hotmail
                </button>
              </div>
            </div>

            {/* Token Input Form */}
            <form onSubmit={handleGenerateEmail} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Token da API
                </label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Ex: 8SCZNGEM2PG9E723DTBC"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    disabled={status !== "idle" && status !== "error"}
                    className="flex-1"
                    autoComplete="off"
                  />
                  <Button
                    type="submit"
                    disabled={status !== "idle" && status !== "error" || !apiToken.trim()}
                    className="px-6"
                  >
                    {status === "idle" || status === "error" ? "Iniciar" : (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processando...
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Insira o token fornecido pela API apishop.biz
                </p>
              </div>
            </form>

            {/* Status Indicator */}
            <div className={`p-4 rounded-lg flex items-center gap-3 transition-all ${statusColors[status]}`}>
              {status === "idle" || status === "error" ? (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              ) : status === "found" ? (
                <CheckCircle2 className="w-5 h-5 flex-shrink-0 animate-pulse" />
              ) : (
                <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
              )}
              <div className="flex-1">
                <span className="font-medium">{statusMessages[status]}</span>
                {status === "monitoring" && (
                  <p className="text-xs opacity-75 mt-1">Isso pode levar alguns minutos...</p>
                )}
              </div>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            {/* Email Display */}
            {email && (
              <div className="space-y-2 animate-fadeIn">
                <label className="block text-sm font-medium text-slate-700">
                  E-mail Gerado ({emailTypeLabel})
                </label>
                <div className={`flex items-center gap-2 p-4 rounded-lg border-2 ${emailTypeColor} hover:border-opacity-100 transition-colors`}>
                  <Mail className={`w-5 h-5 flex-shrink-0 ${emailType === "outlook" ? "text-blue-600" : "text-purple-600"}`} />
	                  <span className="flex-1 font-mono text-sm break-all text-slate-800">{email}</span>
	                  {/* Botão para copiar apenas o prefixo do e-mail */}
	                  <Button
	                    variant="ghost"
	                    size="sm"
	                    onClick={() => copyToClipboard(email.split("@")[0])}
	                    className={`flex-shrink-0 ${emailType === "outlook" ? "hover:bg-blue-100" : "hover:bg-purple-100"}`}
	                    title="Copiar prefixo do e-mail"
	                  >
	                    {copied ? (
	                      <CheckCircle2 className="w-4 h-4 text-green-600" />
	                    ) : (
	                      <Code className="w-4 h-4" />
	                    )}
	                  </Button>
	                  {/* Botão para copiar o e-mail completo */}
	                  <Button
	                    variant="ghost"
	                    size="sm"
	                    onClick={() => copyToClipboard(email)}
	                    className={`flex-shrink-0 ${emailType === "outlook" ? "hover:bg-blue-100" : "hover:bg-purple-100"}`}
	                    title="Copiar e-mail completo"
	                  >
	                    {copied ? (
	                      <CheckCircle2 className="w-4 h-4 text-green-600" />
	                    ) : (
	                      <Copy className="w-4 h-4" />
	                    )}
	                  </Button>
                </div>
              </div>
            )}

            {/* Password Display */}
            {password && (
              <div className="space-y-2 animate-fadeIn">
                <label className="block text-sm font-medium text-slate-700">
                  Senha
                </label>
                <div className="flex items-center gap-2 p-4 bg-purple-50 rounded-lg border-2 border-purple-200 hover:border-purple-300 transition-colors">
                  <Lock className="w-5 h-5 text-purple-600 flex-shrink-0" />
                  <span className="flex-1 font-mono text-sm break-all text-slate-800">{password}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(password)}
                    className="flex-shrink-0 hover:bg-purple-100"
                    title="Copiar senha"
                  >
                    {copied ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Verification Code Display */}
            {verificationCode && (
              <div className="space-y-2 animate-fadeIn">
                <label className="block text-sm font-medium text-slate-700">
                  Código de Verificação
                </label>
                <div className="p-6 bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 rounded-lg border-2 border-green-400 text-center shadow-lg">
                  <div className="text-sm text-slate-600 mb-3 font-medium">✓ Seu código é:</div>
                  <div className="text-6xl font-bold text-green-600 font-mono tracking-widest mb-4 select-all">
                    {verificationCode}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => copyToClipboard(verificationCode)}
                    className="w-full bg-green-600 hover:bg-green-700"
                    title="Copiar código para a área de transferência"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    {copied ? "Código Copiado!" : "Copiar Código"}
                  </Button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              {canRetry && !verificationCode && (
                <Button
                  onClick={handleRetryMonitor}
                  disabled={status === "monitoring"}
                  className="flex-1 bg-amber-600 hover:bg-amber-700"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {status === "monitoring" ? "Tentando..." : "Tentar Novamente"}
                </Button>
              )}
              {(email || verificationCode) && (
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className={canRetry && !verificationCode ? "flex-1" : "w-full"}
                >
                  Novo Processo
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Email List Section */}
        {storedAccessToken && (
          <Card className="shadow-lg mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Últimos E-mails</CardTitle>
                  <CardDescription>Visualize os e-mails recebidos na caixa de entrada</CardDescription>
                </div>
                <Button
                  onClick={async () => {
                    setLoadingEmails(true);
                    try {
                      const result = await listEmailsMutation.mutateAsync({ accessToken: storedAccessToken });
                      if (result.success) {
                        setEmails(result.emails);
                        setShowEmails(!showEmails);
                      } else {
                        setErrorMessage(result.message);
                      }
                    } catch (error) {
                      setErrorMessage("Erro ao carregar e-mails");
                    } finally {
                      setLoadingEmails(false);
                    }
                  }}
                  variant="outline"
                  size="sm"
                  disabled={loadingEmails}
                >
                  {loadingEmails ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Carregando...
                    </>
                  ) : (
                    <>
                      <ChevronDown className={`w-4 h-4 mr-2 transition-transform ${showEmails ? "rotate-180" : ""}`} />
                      {showEmails ? "Ocultar" : "Mostrar"}
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            {showEmails && emails.length > 0 && (
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {emails.map((email) => (
                    <div key={email.id} className="border rounded-lg p-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                      <button
                        onClick={() => setExpandedEmailId(expandedEmailId === email.id ? null : email.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{email.subject}</p>
                            <p className="text-sm text-slate-600 truncate">De: {email.from}</p>
                            <p className="text-xs text-slate-500 mt-1">
                              {new Date(email.receivedDateTime).toLocaleString("pt-BR")}
                            </p>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${
                            expandedEmailId === email.id ? "rotate-180" : ""
                          }`} />
                        </div>
                      </button>
                      {expandedEmailId === email.id && (
                        <div className="mt-3 pt-3 border-t space-y-2">
                          <div className="bg-white p-3 rounded border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                            {email.body || email.bodyPreview || "(sem conteúdo)"}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigator.clipboard.writeText(email.body || email.bodyPreview)}
                            className="w-full"
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar Corpo do E-mail
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
            {showEmails && emails.length === 0 && (
              <CardContent>
                <p className="text-slate-600 text-center py-4">Nenhum e-mail encontrado</p>
              </CardContent>
            )}
          </Card>
        )}

        {/* Info Cards */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="bg-blue-50 border-blue-200 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-600" />
                Como Funciona
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700">
              <ol className="space-y-2">
                <li className="flex gap-2"><span className="font-bold text-blue-600">1</span> Escolha o tipo (Outlook/Hotmail)</li>
                <li className="flex gap-2"><span className="font-bold text-blue-600">2</span> Insira seu token da API</li>
                <li className="flex gap-2"><span className="font-bold text-blue-600">3</span> Sistema gera e-mail automaticamente</li>
                <li className="flex gap-2"><span className="font-bold text-blue-600">4</span> Aguarda e extrai o código</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="bg-purple-50 border-purple-200 hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Code className="w-5 h-5 text-purple-600" />
                Recursos
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-700">
              <ul className="space-y-2">
                <li className="flex items-center gap-2"><span className="text-green-600 font-bold">✓</span> Outlook e Hotmail</li>
                <li className="flex items-center gap-2"><span className="text-green-600 font-bold">✓</span> Automação completa</li>
                <li className="flex items-center gap-2"><span className="text-green-600 font-bold">✓</span> Cópia com um clique</li>
                <li className="flex items-center gap-2"><span className="text-green-600 font-bold">✓</span> Busca em Inbox e Lixeira</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
