# claude-function-hooks

Function hooks para o Claude Code, como um marketplace de plugins. Function
hooks são early access: módulos TypeScript que rodam dentro da sessão, atrás
da flag `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`.

| Plugin | O que faz |
| --- | --- |
| [time](plugins/time) | Hora de envio acima de cada mensagem |
| [gh-ci-status](plugins/gh-ci-status) | Runs do GitHub Actions do repo da sessão, fixos acima do prompt, com link para PR e run |

## Usar

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /caminho/para/claude-function-hooks/plugins
```

Edições nos hooks recarregam sem reiniciar a sessão.

## Desenvolver

```bash
npm test           # node --test, sem dependências
npm run typecheck  # tsc por plugin
npm run format     # prettier
npm run validate   # claude plugin validate
```

Os tipos da API (`.claude/types/`) não vão para o git: gere com `/plugin-types`
dentro de uma sessão do Claude Code na raiz do repo, e regenere após atualizar
o Claude Code.

## Layout de um plugin

```
plugins/gh-ci-status/
  .claude-plugin/plugin.json   manifesto
  hooks/hooks.json             aponta o módulo de entrada
  src/core/                    o modelo de run e o texto derivado dele, sem I/O
  src/utils/                   helpers genéricos (texto)
  src/app/                     casos de uso (o poller)
  src/infra/                   clientes externos (GitHub via gh)
  src/components/              componentes da faixa
  src/hooks/                   a ligação com o engine
  *.test.ts                    ao lado do arquivo testado, rodam no Node
```
