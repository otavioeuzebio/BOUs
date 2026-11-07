# Descritivo BOU — POPs PMPR

App (PWA) para gerar a **descrição sumária do BOU**, conferir os **itens indispensáveis** e consultar **dicas de atendimento**, com base nos POPs da PMPR e, para furto e roubo, no Código Penal.

## Como funciona

- **Acesso restrito:** só entra quem tem login aprovado pelo administrador. O administrador aprova, bloqueia e define o que cada pessoa pode usar: grupos de ocorrência, gerar texto, ver dicas e ser administrador.
- **Modelos protegidos:** os modelos **não ficam neste repositório**. Eles ficam no Firebase (coleção `conteudo`) e só são entregues a usuários aprovados, de acordo com as permissões de cada um (veja `firestore.rules`).
- **4 estilos de texto** para os mesmos dados: Cronológico, Objetivo, Circunstanciado e Por tópicos.
- **Preenchimento rápido:**
  - CEP com busca automática (ViaCEP) e botão "Estou no local" (GPS);
  - lista dos 399 municípios do PR;
  - turno (equipe e viatura) preenchido uma vez;
  - respostas em botões e sugestões em um toque;
  - nomes reaproveitados entre os campos;
  - botão "agora" para os horários;
  - ditado por voz;
  - frases prontas;
  - campos secundários em "Mais detalhes".
- **Rascunhos e frases:** ficam só no aparelho e são apagados automaticamente depois do prazo escolhido.

## Novidades da v3

- **Envolvidos:** cadastrados uma vez e usados em todos os campos e no texto.
- **Linha do tempo:** chegada, saída para a DP, apresentação e encerramento.
- **Postos e graduações:** da equipe, de Soldado 3ª Classe a Coronel, incluindo Cadete e Aspirante.
- **Blocos de abordagem:**
  - busca pessoal/veicular com a fundamentação do Manual de Abordagem (CPP 244; STJ RHC 158.580 e Teses 236/237), com alertas quando os elementos são insuficientes;
  - uso da força e algemas (Dir. 004/2015, Lei 13.060, Dec. 12.341/24, SV 11);
  - entrada em domicílio (Tema 280 STF, HC 598.051, Nota BG E00060/2023, ACED).
- **Novas fichas:**
  - Outros crimes: lesão corporal, ameaça, desacato/resistência/desobediência, arma ilegal, receptação, dano, estelionato, pessoa desaparecida e local de morte.
  - Trânsito: acidente e embriaguez ao volante.
- **Contatos por município:** delegacias, Conselho Tutelar, CREAS etc., sugeridos pelos usuários e aprovados pelo administrador.
- **Sugestão de correção:** enviada ao administrador a partir de cada ficha.
- **Acesso com prazo de validade:** definido por usuário.
- **Estatística de uso:** sem dados pessoais.
- **Editor de modelos:** no painel Admin.
- **Bloqueio por PIN ou digital/rosto** e limpeza dos rascunhos ao sair.
- **Modo estudo:** quiz e cartões de revisão.

## Arquivos

```
index.html          tela e estilos
app.js              app (login, permissões, gerador de texto, painel admin)
firebase-config.js  dados do projeto Firebase + e-mail do administrador
municipios.js       399 municípios do PR (IBGE)
firestore.rules     regras de segurança (copiar para o Firebase)
sw.js, manifest.webmanifest, icons/   PWA / instalação
```

Os arquivos de conteúdo (`base.js`, `ocorr.js`, `patrimonio.js`, `geral.js`, `transito.js`, `custodia.js`, `crise.js`, `gestao.js`) ficam **fora** do repositório e são enviados pelo **painel Admin** do app.

## Configurar o Firebase (uma vez)

1. Em console.firebase.google.com, crie um projeto (ex.: `descritivo-bou`).
2. Em **Authentication → Método de login**, ative **E-mail/senha**.
3. Em **Firestore Database**, crie o banco (modo de produção, região `southamerica-east1`).
4. Em **Firestore → Regras**, cole o conteúdo de `firestore.rules` e clique em **Publicar**.
5. Em **Configurações do projeto → Seus apps → Web (</>)**, registre o app e copie o `firebaseConfig` para `firebase-config.js`.
6. Em **Authentication → Configurações → Domínios autorizados**, adicione `otavioeuzebio.github.io`.
7. Abra o app, clique em **Solicitar acesso** com o e-mail de administrador e entre. Sua conta já entra aprovada como administrador.
8. No painel **Admin**, clique em **Enviar arquivos de conteúdo** e selecione os 8 arquivos `.js`.

## Atualizar

- **Modelos:** edite os arquivos de conteúdo e envie de novo pelo painel Admin. Todos recebem a atualização sem reinstalar.
- **App:** envie para o GitHub e mude o `CACHE` em `sw.js` (ex.: `descritivo-bou-v3`).

> Ferramenta de apoio. Não substitui os POPs, as diretrizes e o julgamento do policial. Confira tudo antes de lançar no BOU.
