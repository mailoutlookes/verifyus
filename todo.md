# Outlook Email Verifier - TODO

## Funcionalidades Principais

- [ ] Interface de entrada para token da API (input + botão submit)
- [ ] Integração com API apishop.biz para gerar e-mail Outlook
- [ ] Exibição do e-mail gerado de forma destacada e copiável
- [ ] Obtenção de access token via OAuth2/Microsoft Graph API
- [ ] Conexão com Outlook e acesso à caixa de entrada
- [ ] Monitoramento automático da caixa de entrada
- [ ] Extração de código de verificação (6 dígitos) dos e-mails
- [ ] Exibição do código de verificação em destaque
- [ ] Sistema de status em tempo real (gerando email, conectando, aguardando código, etc.)
- [ ] Pooling/refresh automático para verificar novos e-mails
- [ ] Interface moderna, responsiva e user-friendly
- [ ] Tratamento de erros e feedback ao usuário

## Fases de Implementação

### Fase 1: Análise e Planejamento ✓
- [x] Projeto web inicializado com React + Express + MySQL
- [x] Estrutura base criada

### Fase 2: Interface do Usuário (UI) ✓
- [x] Design da página principal
- [x] Campo de input para token da API
- [x] Botão de submit
- [x] Área de exibição do e-mail gerado
- [x] Área de exibição do código de verificação
- [x] Indicador de status do processo
- [x] Responsividade mobile

### Fase 3: Lógica Backend - Geração de E-mail ✓
- [x] Endpoint para receber token da API
- [x] Integração com API apishop.biz
- [x] Validação de resposta da API
- [x] Armazenamento de dados (email, password, refresh_token, client_id)
- [x] Retorno de dados para o frontend

### Fase 4: Lógica Backend - OAuth2 e Microsoft Graph ✓
- [x] Obtenção de access token usando refresh_token
- [x] Tratamento de erros de autenticação
- [x] Gerenciamento de expiração de token
- [x] Integração com Microsoft Graph API

### Fase 5: Lógica Backend - Monitoramento de E-mails ✓
- [x] Busca de e-mails na caixa de entrada
- [x] Extração de código de verificação (regex para 6 dígitos)
- [x] Pooling automático
- [x] Tratamento de e-mails já processados

### Fase 6: Refinamento e UX ✓
- [x] Sistema de status em tempo real
- [x] Animações e transições
- [x] Tratamento de erros com mensagens amigáveis
- [x] Validação robusta de entrada
- [x] Testes de funcionalidade

### Fase 7: Entrega ✓
- [x] Documentação de uso (userGuide.md)
- [x] Instruções de deployment
- [x] Checkpoint final


## Bugs e Melhorias Relatadas

- [x] Melhorar mensagens de erro da API apishop.biz (detectar "No balance" e mostrar mensagem clara)
- [x] Adicionar logging detalhado de erros para debugging
- [x] Validar inputs (refresh_token, client_id, access_token)
- [x] Corrigir Content-Type para requisição OAuth
- [x] Adicionar timeouts para evitar travamentos
- [ ] Adicionar retry automático com backoff exponencial
- [ ] Implementar timeout customizável para monitoramento de inbox

## Novos Bugs Relatados - Sessão 2

- [x] Regex para extração de código não está capturando o formato "Your verification code:995908" (sem espaço)
- [x] Aumentar tempo de monitoramento/tentativas para capturar e-mails que chegam mais tarde
- [x] Adicionar botão "Tentar Novamente" para remonitorar inbox sem gerar novo e-mail
- [x] Melhorar busca de e-mails para incluir body completo, não apenas bodyPreview

## Bugs Relatados - Sessão 3

- [x] Regex capturando números aleatórios (707070) que não são códigos de verificação
- [x] Adicionar validação mais inteligente para distinguir código real de outros números
- [ ] Adicionar delay inicial antes de buscar (dar tempo pro e-mail chegar)
- [ ] Priorizar e-mails recentes


## Bugs Relatados - Sessão 4

- [x] Buscar código também na pasta Lixeira (deletedItems) além de inbox
- [x] Flexibilizar validação de contexto para capturar mais códigos
- [x] Exibir senha gerada junto com o e-mail (com botão de copiar)
- [x] Aumentar busca para 30 e-mails em vez de 20


## Bugs Relatados - Sessão 5

- [x] Validação de contexto voltou a capturar 707070 (número aleatório)
- [x] Rebalancear: Ser flexível mas não pegar números isolados
- [x] Sempre validar contexto mesmo para código único


## Novas Funcionalidades - Sessão 6

- [x] Adicionar seletor de tipo de e-mail (Outlook ou Hotmail)
- [x] Passar tipo selecionado para a API (type=outlook ou type=hotmail)
- [x] Ajustar chamada da API conforme a escolha do usuário
- [x] Melhorar UX para mostrar qual tipo foi selecionado


## Novas Funcionalidades - Sessão 7

- [x] Melhorar validação de código (ser mais rigoroso com contexto - exige 2+ palavras-chave)
- [x] Adicionar botão "Mostrar/Ocultar" para listar e-mails
- [x] Listar últimos e-mails recebidos (assunto, remetente, data)
- [x] Permitir visualizar corpo completo de cada e-mail
- [x] Endpoint para listar e-mails da caixa de entrada
- [x] Botão para copiar corpo do e-mail
