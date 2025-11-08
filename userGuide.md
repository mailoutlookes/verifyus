# Outlook Email Verifier - Guia do Usuário

## Informações Gerais

**Propósito:** Automatize completamente a geração de e-mails Outlook e a extração de códigos de verificação de 6 dígitos com uma única clique.

**Acesso:** Público - sem necessidade de login

## Powered by Manus

Este sistema foi construído com tecnologia de ponta:

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 para interface moderna e responsiva
- **Backend:** Express 4 + tRPC 11 para APIs type-safe e performáticas
- **Banco de Dados:** MySQL/TiDB com Drizzle ORM para gerenciamento robusto de dados
- **Autenticação:** Integração OAuth2 com Microsoft Graph API para acesso seguro ao Outlook
- **Deployment:** Auto-scaling infrastructure com global CDN para máxima disponibilidade

## Usando Seu Sistema

### Passo 1: Inserir Token da API

Clique no campo "Token da API" e insira seu token fornecido pela plataforma apishop.biz. O token deve ter pelo menos 10 caracteres.

**Exemplo de token válido:** `8SCZNGEM2PG9E723DTBC`

### Passo 2: Iniciar o Processo

Clique no botão "Iniciar" para começar a automação. O sistema executará automaticamente:

1. **Geração de E-mail** - Cria um novo e-mail Outlook único
2. **Conexão ao Outlook** - Autentica-se usando OAuth2
3. **Monitoramento** - Aguarda a chegada do código de verificação
4. **Extração** - Localiza e extrai o código de 6 dígitos

### Passo 3: Copiar E-mail Gerado

Após a geração bem-sucedida, seu e-mail aparecerá em destaque. Clique no ícone de cópia para copiar o e-mail para a área de transferência instantaneamente.

### Passo 4: Obter Código de Verificação

O sistema monitora automaticamente sua caixa de entrada. Quando o código de verificação chegar, ele será exibido em grande destaque com fundo verde. Clique em "Copiar Código" para copiar os 6 dígitos.

### Status em Tempo Real

Durante o processo, você verá indicadores de status que mostram exatamente em qual etapa o sistema está:

- **Pronto para começar** - Aguardando seu token
- **Gerando e-mail Outlook...** - Criando novo e-mail
- **Conectando ao Outlook...** - Autenticando com Microsoft
- **Aguardando código de verificação...** - Monitorando caixa de entrada
- **Código encontrado!** - Sucesso, código extraído

## Gerenciando Seu Sistema

### Dashboard e Monitoramento

Acesse o painel de controle através do Management UI para:

- **Preview:** Visualize o sistema ao vivo
- **Database:** Gerencie dados armazenados
- **Settings:** Configure preferências e segredos da API
- **Dashboard:** Monitore uso e estatísticas

### Tratamento de Erros

Se encontrar um erro:

1. Verifique se seu token é válido e tem pelo menos 10 caracteres
2. Certifique-se de que sua conexão com a internet está estável
3. Aguarde alguns segundos e tente novamente
4. Se o problema persistir, verifique o console do navegador para mais detalhes

### Limpeza de Dados

Após cada uso bem-sucedido, os dados são processados e podem ser consultados no banco de dados através do Management UI.

## Recursos Principais

✓ **Automação Completa** - Nenhuma intervenção manual necessária

✓ **Interface Intuitiva** - Design moderno e fácil de usar

✓ **Cópia com Um Clique** - Copie e-mail e código instantaneamente

✓ **Status em Tempo Real** - Acompanhe cada etapa do processo

✓ **Validação Robusta** - Verificação de dados em tempo real

✓ **Responsivo** - Funciona perfeitamente em desktop, tablet e mobile

## Próximos Passos

Converse com a IA Manus a qualquer momento para solicitar melhorias, novos recursos ou ajustes no sistema. Você pode:

- Adicionar novos tipos de e-mail
- Implementar suporte para outros provedores
- Customizar o design e comportamento
- Integrar com outros serviços

**Comece agora:** Insira seu token e clique em "Iniciar" para automatizar seu fluxo de verificação de e-mail!
