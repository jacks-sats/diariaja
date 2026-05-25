# DiáriaJá

Marketplace mobile-first que conecta empregadores a diaristas no Brasil,
com foco inicial em Campo Grande / MS.

- App: https://diariaja.vercel.app
- Suporte: suporte@diariaja.com.br

## Propriedade intelectual

**Copyright (c) 2025–2026 Jackson dos Santos da Silva. Todos os direitos
reservados.**

Este software, sua marca ("DiáriaJá" / "Trampojá"), layout, código-fonte
e documentação são obra intelectual protegida pelas Leis 9.609/98
(Software) e 9.610/98 (Direitos Autorais) do Brasil.

A disponibilidade pública deste repositório no GitHub **não** constitui
licença de uso, cessão ou autorização. Veja o arquivo [`LICENSE`](./LICENSE).

Para licenciamento, parcerias ou consultas comerciais:
**suporte@diariaja.com.br**

## Documentação técnica

Para detalhes de arquitetura, convenções de código e fluxo de
desenvolvimento, veja [`CLAUDE.md`](./CLAUDE.md).

## Níveis de confiabilidade

Cadastro com mínimo atrito — dados adicionais sobem o nível do
usuário, destravando funcionalidades e aumentando a confiança na
plataforma. O nível é calculado puramente a partir do que está
preenchido no perfil (ver `helpers.ts:calcularNivelConfiabilidade`).

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│    Nível 1            Nível 2            Nível 3        Nível 4    │
│   ┌──────┐           ┌─────────┐       ┌──────────┐   ┌────────┐   │
│   │BÁSICO│  ──CPF─►  │VERIF.   │ ──KYC►│CONFIÁVEL │ 2FA│PREMIUM │   │
│   │  📱  │           │  ou     │       │   ✅     │ ──►│   💎   │   │
│   │      │           │  CNPJ   │       │          │   │        │   │
│   └──────┘           └─────────┘       └──────────┘   └────────┘   │
│                                                                    │
│   Telefone           + Documento       + Foto de        + 2FA      │
│   verificado         (CPF / CNPJ)        identidade     ativado    │
│   por SMS                                aprovada por              │
│   (ou e-mail                             KYC                       │
│    confirmado)                                                     │
│                                                                    │
│   Pode:              Pode:             Pode:           Pode:       │
│   • Navegar          • Tudo do N1      • Tudo do N2    • Tudo +    │
│   • Ver vagas        • Candidatar-se   • Recursos      • Limites   │
│   • Ver perfis       • Publicar vagas    de maior        maiores   │
│   • Conversar          (depende do       valor                     │
│                        plano)                                      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### Regras importantes

1. **Cadastro inicial nunca é bloqueado** por falta de CPF, e-mail,
   ou documento. Tudo isso vira progressão de nível.
2. **Grandfathering**: contas antigas (email+CPF) entram em Nível 2
   automaticamente — não precisam re-cadastrar.
3. **Login flexível**: e-mail+senha hoje funciona como base. Phone+OTP
   e Google ficam habilitados conforme os provedores são configurados
   no Supabase Dashboard.
4. **Validações específicas por nível**:
   - Telefone: formato BR + DDD válido + OTP via SMS (Supabase Auth)
   - CPF: dígito verificador real (`helpers.ts:validarCPF`)
   - CNPJ: comprimento 14 (validação de dígito pendente)
   - E-mail: `helpers.ts:validarEmail` + confirmação por link
   - Documento (Nível 3): integração KYC pendente

### Dependências externas para destravar 100% dos níveis

| Item | Status hoje | Como destravar |
|------|-------------|----------------|
| SMS OTP | UI pronta, depende de provider | Configurar Twilio/MessageBird no Supabase → Authentication → Providers → Phone |
| Login Google | Não configurado | Supabase → Authentication → Providers → Google + Google Cloud Console |
| KYC de documento | Migration pronta, fluxo placeholder | Integrar Unico / Idwall / Caf |
| 2FA (TOTP) | Não integrado | Supabase MFA (precisa plano Pro) ou TOTP custom |
