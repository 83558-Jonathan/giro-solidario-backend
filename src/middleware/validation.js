const Joi = require('joi')

// ===========================================
// SCHEMA: Registro de usuário
// Cadastro simplificado: nome, email, cpf, senha
// ===========================================
const registerSchema = Joi.object({
  nome: Joi.string().min(3).max(100).required().messages({
    'string.base': 'Nome inválido',
    'string.empty': 'Nome é obrigatório',
    'string.min': 'Nome deve ter pelo menos 3 caracteres',
    'string.max': 'Nome muito longo (máximo 100 caracteres)',
    'any.required': 'Nome é obrigatório'
  }),

  email: Joi.string().email().required().messages({
    'string.base': 'Email inválido',
    'string.empty': 'Email é obrigatório',
    'string.email': 'Digite um email válido (ex: seu@email.com)',
    'any.required': 'Email é obrigatório'
  }),

  cpf: Joi.string()
    .pattern(/^[0-9]{11}$/)
    .required()
    .messages({
      'string.base': 'CPF inválido',
      'string.empty': 'CPF é obrigatório',
      'string.pattern.base': 'CPF deve ter 11 dígitos (só números)',
      'any.required': 'CPF é obrigatório'
    }),

  senha: Joi.string().min(6).required().messages({
    'string.base': 'Senha inválida',
    'string.empty': 'Senha é obrigatória',
    'string.min': 'Senha deve ter pelo menos 6 caracteres',
    'any.required': 'Senha é obrigatória'
  }),

  codigoConvite: Joi.string().optional().allow('', null)
})

// ===========================================
// SCHEMA: Login
// Aceita email OU cpf (pelo menos um dos dois)
// ===========================================
const loginSchema = Joi.object({
  email: Joi.string().email().optional().allow('', null).messages({
    'string.base': 'Email inválido',
    'string.email': 'Digite um email válido (ex: seu@email.com)'
  }),

  cpf: Joi.string()
    .pattern(/^[0-9]{11}$/)
    .optional()
    .allow('', null)
    .messages({
      'string.base': 'CPF inválido',
      'string.pattern.base': 'CPF deve ter 11 dígitos (só números)'
    }),

  senha: Joi.string().required().messages({
    'string.base': 'Senha inválida',
    'string.empty': 'Senha é obrigatória',
    'any.required': 'Senha é obrigatória'
  })
})
  .or('email', 'cpf')
  .messages({
    'object.missing': 'Informe seu email ou CPF'
  })

// ===========================================
// SCHEMA: Esqueceu a senha
// ===========================================
const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.base': 'Email inválido',
    'string.empty': 'Email é obrigatório',
    'string.email': 'Digite um email válido (ex: seu@email.com)',
    'any.required': 'Email é obrigatório'
  })
})

// ===========================================
// SCHEMA: Reset de senha
// Só exige tamanho mínimo (6 caracteres)
// ===========================================
const resetPasswordSchema = Joi.object({
  token: Joi.string().required().messages({
    'string.base': 'Token inválido',
    'string.empty': 'Token é obrigatório',
    'any.required': 'Token é obrigatório'
  }),

  senha: Joi.string().min(6).required().messages({
    'string.base': 'Senha inválida',
    'string.empty': 'Nova senha é obrigatória',
    'string.min': 'Senha deve ter pelo menos 6 caracteres',
    'any.required': 'Nova senha é obrigatória'
  })
})

// ===========================================
// HELPER: resposta amigável para erros de validação
// ===========================================
function responderErroValidacao (res, error) {
  // Pega a primeira mensagem; se vazia, usa fallback
  const detalhe = error?.details?.[0]
  const mensagem =
    detalhe?.message || 'Dados inválidos. Verifique e tente novamente.'

  // Log detalhado em dev para facilitar debug
  if (process.env.NODE_ENV === 'development') {
    console.warn('⚠️ [validação]', {
      path: detalhe?.path?.join('.'),
      type: detalhe?.type,
      message: mensagem
    })
  }

  return res.status(400).json({
    success: false,
    error: mensagem
  })
}

// ===========================================
// MIDDLEWARES
// ===========================================
const validateRegister = (req, res, next) => {
  const { error, value } = registerSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true // remove campos extras (ex: telefone, chavePix, se vierem)
  })
  if (error) return responderErroValidacao(res, error)
  req.body = value
  next()
}

const validateLogin = (req, res, next) => {
  const { error, value } = loginSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) return responderErroValidacao(res, error)
  req.body = value
  next()
}

const validateForgotPassword = (req, res, next) => {
  const { error, value } = forgotPasswordSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) return responderErroValidacao(res, error)
  req.body = value
  next()
}

const validateResetPassword = (req, res, next) => {
  const { error, value } = resetPasswordSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) return responderErroValidacao(res, error)
  req.body = value
  next()
}

module.exports = {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword
}
