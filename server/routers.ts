import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { insertLog, getAllLogs } from "./db";
import { z } from "zod";
import axios, { AxiosError } from "axios";

// Helper function to get access token from refresh token
async function getAccessTokenFromRefreshToken(
  refreshToken: string,
  clientId: string
): Promise<string> {
  try {
    console.log("[OAuth] Requesting access token from Microsoft...");
    
    const response = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 10000,
      }
    );
    
    console.log("[OAuth] Access token obtained successfully");
    return response.data.access_token;
  } catch (error) {
    const axiosError = error as AxiosError;
    const errorData = axiosError.response?.data as any;
    
    console.error("[OAuth] Error details:", {
      status: axiosError.response?.status,
      error: errorData?.error,
      description: errorData?.error_description,
    });
    
    if (errorData?.error === "invalid_grant") {
      throw new Error("Refresh token inválido ou expirado. Tente gerar um novo e-mail.");
    } else if (errorData?.error === "invalid_client") {
      throw new Error("ID do cliente inválido. Verifique os dados do e-mail gerado.");
    } else if (errorData?.error_description) {
      throw new Error(`Erro OAuth: ${errorData.error_description}`);
    }
    
    throw new Error("Falha ao obter access token do Outlook");
  }
}

// Helper function to extract verification code from email body - STRICT VERSION
function extractVerificationCode(text: string): string | null {
  if (!text) return null;
  
  console.log(`[Extract] Searching in text (length: ${text.length})`);
  
  // PRIORITY 1: Look for code explicitly mentioned with keywords
  const keywordPatterns = [
    /(?:your\s+)?(?:verification\s+)?code[:\s]+([0-9]{6})/i,
    /verification[:\s]+([0-9]{6})/i,
    /verify(?:ing)?\s+code[:\s]+([0-9]{6})/i,
    /code\s+(?:is|:)\s+([0-9]{6})/i,
    /6[:\s\-]*digit[:\s\-]+code[:\s]+([0-9]{6})/i,
    /enter[:\s]+([0-9]{6})/i,
  ];
  
  for (const pattern of keywordPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      console.log(`[Extract] ✓ Found code with keyword pattern: ${match[1]}`);
      return match[1];
    }
  }
  
  // PRIORITY 2: Look for 6-digit numbers in STRONG verification context
  // Regex corrigida para evitar a detecção de códigos de cores hexadecimais (#XXXXXX)
  // Busca por 6 dígitos que não são precedidos por um '#' e que estão em uma borda de palavra (\b)
  const allMatches = text.match(/(?<!#)\b\d{6}\b/g);
  
  if (allMatches && allMatches.length > 0) {
    const uniqueCodes = Array.from(new Set(allMatches));
    
    for (const code of uniqueCodes) {
      const codeIndex = text.indexOf(code);
      const contextStart = Math.max(0, codeIndex - 150);
      const contextEnd = Math.min(text.length, codeIndex + 150);
      const context = text.substring(contextStart, contextEnd).toLowerCase();
      
      // STRICT: Must have at least 2 verification keywords nearby
      const verificationKeywords = [
        "code",
        "verification",
        "verify",
        "confirm",
        "authenticate",
        "enter",
        "use",
        "6-digit",
        "six digit",
        "6 digit"
      ];
      
      const keywordCount = verificationKeywords.filter(kw => context.includes(kw)).length;
      
      // Require at least 2 keywords for strong confidence
      if (keywordCount >= 2) {
        console.log(`[Extract] ✓ Found code in STRONG verification context (${keywordCount} keywords): ${code}`);
        return code;
      }
      
      if (keywordCount === 1) {
        console.log(`[Extract] ? Found code with weak context (${keywordCount} keyword): ${code} - SKIPPING`);
      }
    }
    
    console.log(`[Extract] ✗ Found ${uniqueCodes.length} codes but NONE in strong verification context`);
    return null;
  }
  
  console.log(`[Extract] ✗ No 6-digit code found in text`);
  return null;
}

// Helper function to list emails from multiple folders
async function listEmailsFromFolders(
  accessToken: string,
  folderIds: string[],
  limit: number = 15
): Promise<Array<{
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
}>> {
  try {
    console.log(`[List] Fetching emails from folders: ${folderIds.join(", ")}...`);
    
    let allMessages: any[] = [];
    
    for (const folderId of folderIds) {
      const response = await axios.get(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $top: limit, // Limita a busca em cada pasta
            $orderby: "receivedDateTime desc",
            $select: "id,subject,from,receivedDateTime,bodyPreview,body",
          },
          timeout: 10000,
        }
      );
      
      allMessages = allMessages.concat(response.data.value || []);
    }

    // Ordenar todos os e-mails por data de recebimento (mais recente primeiro)
    allMessages.sort((a, b) => {
      return new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime();
    });

    // Limitar ao número total desejado
    const finalMessages = allMessages.slice(0, limit);

    console.log(`[List] Found ${finalMessages.length} emails (combined from ${folderIds.length} folders)`);

    return finalMessages.map((msg: any) => ({
      id: msg.id,
      subject: msg.subject || "(sem assunto)",
      from: msg.from?.emailAddress?.address || "desconhecido",
      receivedDateTime: msg.receivedDateTime || "",
      bodyPreview: msg.bodyPreview || "",
      body: msg.body?.content || "",
    }));
  } catch (error) {
    console.error("[List] Error fetching emails:", error);
    throw new Error("Erro ao listar e-mails");
  }
}

// Helper function to list emails from inbox (wrapper for compatibility)
async function listInboxEmails(
  accessToken: string,
  limit: number = 15
): Promise<Array<{
  id: string;
  subject: string;
  from: string;
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
}>> {
  // Pastas a serem incluídas na lista de "últimos e-mails"
  const foldersToSearch = ["inbox", "deleteditems", "junkemail"];
  return listEmailsFromFolders(accessToken, foldersToSearch, limit);
}

// Helper function to search messages in a folder
async function searchMessagesInFolder(
  accessToken: string,
  folderId: string,
  folderName: string
): Promise<string | null> {
  try {
    console.log(`[Search] Searching in ${folderName}...`);
    
    const response = await axios.get(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          $top: 30,
          $orderby: "receivedDateTime desc",
          $select: "id,subject,bodyPreview,body,from,receivedDateTime",
        },
        timeout: 10000,
      }
    );

    const messages = response.data.value || [];
    console.log(`[Search] Found ${messages.length} messages in ${folderName}`);

    for (const message of messages) {
      const bodyText = message.body?.content || message.bodyPreview || "";
      
      if (bodyText) {
        console.log(`[Search] Checking message in ${folderName}: "${message.subject}"`);
        const code = extractVerificationCode(bodyText);
        if (code) {
          console.log(`[Search] ✓ Verification code found in ${folderName}: ${code}`);
          return code;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[Search] Error searching ${folderName}:`, error);
    return null;
  }
}

// Helper function to monitor inbox and find verification code
async function monitorInboxForCode(
  accessToken: string,
  maxAttempts: number = 60,
  delayMs: number = 2000
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      console.log(`[Inbox] Checking for verification code (attempt ${attempt + 1}/${maxAttempts})`);
      
      // Search in inbox first
      let code = await searchMessagesInFolder(accessToken, "inbox", "Inbox");
      if (code) return code;
      
      // Then search in deleted items (trash)
      code = await searchMessagesInFolder(accessToken, "deleteditems", "Deleted Items");
      if (code) return code;

      // Then search in junk email (spam)
      code = await searchMessagesInFolder(accessToken, "junkemail", "Junk Email");
      if (code) return code;

      // Wait before next attempt
      if (attempt < maxAttempts - 1) {
        const waitTime = delayMs + (attempt * 100);
        console.log(`[Inbox] Waiting ${waitTime}ms before next check...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error("[Inbox] Error checking messages:", {
        status: axiosError.response?.status,
        message: axiosError.message,
      });
      
      if (axiosError.response?.status === 401) {
        throw new Error("Sessão expirada. Tente gerar um novo e-mail.");
      } else if (axiosError.response?.status === 403) {
        throw new Error("Permissão negada. Verifique suas credenciais do Outlook.");
      }
      
      throw new Error("Erro ao monitorar caixa de entrada");
    }
  }

  return null;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  outlook: router({
    // Generate email via apishop.biz API
    generateEmail: publicProcedure
      .input(z.object({ 
        token: z.string(),
        type: z.enum(["outlook", "hotmail"]).default("outlook")
      }))
      .mutation(async ({ input }) => {
        try {
          console.log(`[API] Requesting ${input.type} email from apishop.biz...`);
          
          const response = await axios.get(
            `https://apishop.biz/api/buy?type=${input.type}&tokens=${input.token}`,
            { timeout: 10000 }
          );

          if (!response.data.success) {
            let errorMessage = response.data.message || "Erro ao gerar e-mail";
            
            if (errorMessage.toLowerCase().includes("no balance")) {
              errorMessage = "Saldo insuficiente na sua conta apishop.biz. Por favor, adicione créditos.";
            } else if (errorMessage.toLowerCase().includes("invalid token")) {
              errorMessage = "Token inválido. Verifique seu token da API apishop.biz.";
            } else if (errorMessage.toLowerCase().includes("token expired")) {
              errorMessage = "Token expirado. Por favor, gere um novo token.";
            } else if (errorMessage.toLowerCase().includes("no stock")) {
              errorMessage = "Sem estoque disponível para este tipo. Tente o outro tipo (Outlook/Hotmail).";
            }
            
            console.log("[API] Error:", errorMessage);
            
            return {
              success: false,
              message: errorMessage,
              result: [],
            };
          }

          console.log("[API] Email generated successfully");

          const emailData = response.data.result[0];
          if (!emailData || !emailData.email || !emailData.password) {
            throw new Error("API retornou dados de e-mail incompletos.");
          }

          // Inserir log no banco de dados
          await insertLog({
            apiToken: input.token,
            email: emailData.email,
            password: emailData.password,
          });
          
          return {
            success: true,
            message: response.data.message,
            result: response.data.result,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Erro desconhecido ao processar a API.";
          
          console.error("[API] Connection error:", errorMsg);
          
          return {
            success: false,
            message: `Erro ao conectar com apishop.biz: ${errorMsg}`,
            result: [],
          };
        }
      }),

    // Get access token from refresh token
    getAccessToken: publicProcedure
      .input(
        z.object({
          refreshToken: z.string(),
          clientId: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          if (!input.refreshToken || input.refreshToken.length < 10) {
            return {
              success: false,
              message: "Refresh token inválido ou incompleto",
              accessToken: "",
            };
          }

          if (!input.clientId || input.clientId.length < 10) {
            return {
              success: false,
              message: "Client ID inválido ou incompleto",
              accessToken: "",
            };
          }

          const accessToken = await getAccessTokenFromRefreshToken(
            input.refreshToken,
            input.clientId
          );
          
          return {
            success: true,
            accessToken,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Erro ao conectar ao Outlook";
          
          console.error("[OAuth] Mutation error:", errorMessage);
          
          return {
            success: false,
            message: errorMessage,
            accessToken: "",
          };
        }
      }),

    // Monitor inbox and find verification code
    monitorInbox: publicProcedure
      .input(z.object({ accessToken: z.string() }))
      .mutation(async ({ input }) => {
        try {
          if (!input.accessToken || input.accessToken.length < 10) {
            return {
              success: false,
              message: "Access token inválido ou incompleto",
              verificationCode: "",
            };
          }

          console.log("[Monitor] Starting inbox monitoring...");
          
          const verificationCode = await monitorInboxForCode(input.accessToken);

          if (!verificationCode) {
            console.log("[Monitor] No verification code found");
            
            return {
              success: false,
              message: "Código de verificação não encontrado. Verifique se o e-mail chegou e contém um código de 6 dígitos.",
              verificationCode: "",
            };
          }

          console.log("[Monitor] Verification code extracted successfully");
          
          return {
            success: true,
            message: "Código de verificação encontrado com sucesso!",
            verificationCode,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Erro ao monitorar caixa de entrada";
          
          console.error("[Monitor] Error:", errorMessage);
          
          return {
            success: false,
            message: errorMessage,
            verificationCode: "",
          };
        }
      }),

    // Retry monitoring without generating new email
    retryMonitorInbox: publicProcedure
      .input(z.object({ accessToken: z.string() }))
      .mutation(async ({ input }) => {
        try {
          if (!input.accessToken || input.accessToken.length < 10) {
            return {
              success: false,
              message: "Access token inválido ou incompleto",
              verificationCode: "",
            };
          }

          console.log("[Retry] Retrying inbox monitoring...");
          
          const verificationCode = await monitorInboxForCode(input.accessToken);

          if (!verificationCode) {
            console.log("[Retry] No verification code found");
            
            return {
              success: false,
              message: "Código de verificação não encontrado. Tente novamente em alguns momentos.",
              verificationCode: "",
            };
          }

          console.log("[Retry] Verification code extracted successfully");
          
          return {
            success: true,
            message: "Código de verificação encontrado com sucesso!",
            verificationCode,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Erro ao monitorar caixa de entrada";
          
          console.error("[Retry] Error:", errorMessage);
          
          return {
            success: false,
            message: errorMessage,
            verificationCode: "",
          };
        }
      }),

    // List all logs
    listLogs: publicProcedure
      .input(z.void())
      .mutation(async () => {
        try {
          const logs = await getAllLogs();
          
          return {
            success: true,
            message: `${logs.length} logs encontrados`,
            logs,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Erro ao listar logs";
          
          console.error("[ListLogs] Error:", errorMessage);
          
          return {
            success: false,
            message: errorMessage,
            logs: [],
          };
        }
      }),

    // List emails from inbox
    listEmails: publicProcedure
      .input(z.object({ accessToken: z.string() }))
      .mutation(async ({ input }) => {
        try {
          if (!input.accessToken || input.accessToken.length < 10) {
            return {
              success: false,
              message: "Access token inválido",
              emails: [],
            };
          }

          console.log("[ListEmails] Fetching emails...");
          
          const emails = await listInboxEmails(input.accessToken);

          return {
            success: true,
            message: `${emails.length} e-mails encontrados`,
            emails,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Erro ao listar e-mails";
          
          console.error("[ListEmails] Error:", errorMessage);
          
          return {
            success: false,
            message: errorMessage,
            emails: [],
          };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
