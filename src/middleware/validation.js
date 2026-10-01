const Joi = require('joi')

// ===========================================
// SCHEMA: Registro de usuário
// Cadastro simplificado: nome, email, cpf, senha
// ===========================================
const registerSchema = Joi.object({
  nome: Joi.string().min(3).max(100).required().messages({
    'string.empty': 'Nome é obrigatório',
    'string.min': 'Nome deve ter pelo menos 3 caracteres',
    'any.required': 'Nome é obrigatório'
  }),

  email: Joi.string().email().required().messages({
    'string.email': 'Email inválido',
    'string.empty': 'Email é obrigatório',
    'any.required': 'Email é obrigatório'
  }),

  cpf: Joi.string()
    .pattern(/^[0-9]{11}$/)
    .required()
    .messages({
      'string.pattern.base': 'CPF deve ter 11 dígitos',
      'string.empty': 'CPF é obrigatório',
      'any.required': 'CPF é obrigatório'
    }),

  senha: Joi.string().min(6).required().messages({
    'string.min': 'Senha deve ter pelo menos 6 caracteres',
    'string.empty': 'Senha é obrigatória',
    'any.required': 'Senha é obrigatória'
  }),

  codigoConvite: Joi.string().optional().allow('', null)
})

// ===========================================
// SCHEMA: Login
// Aceita email OU cpf (pelo menos um dos dois)
// ===========================================
const loginSchema = Joi.object({
  email: Joi.string().email().optional().allow('', null),
  cpf: Joi.string()
    .pattern(/^[0-9]{11}$/)
    .optional()
    .allow('', null),
  senha: Joi.string().required().messages({
    'string.empty': 'Senha é obrigatória',
    'any.required': 'Senha é obrigatória'
  })
})
  .or('email', 'cpf')
  .messages({
    'object.missing': 'Informe email ou CPF'
  })

// ===========================================
// SCHEMA: Esqueceu a senha
// ===========================================
const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Email inválido',
    'any.required': 'Email é obrigatório'
  })
})

// ===========================================
// SCHEMA: Reset de senha
// Só exige tamanho mínimo (6 caracteres)
// ===========================================
const resetPasswordSchema = Joi.object({
  token: Joi.string().required().messages({
    'any.required': 'Token é obrigatório'
  }),
  senha: Joi.string().min(6).required().messages({
    'string.min': 'Senha deve ter pelo menos 6 caracteres',
    'any.required': 'Nova senha é obrigatória'
  })
})

// ===========================================
// MIDDLEWARES
// ===========================================
const validateRegister = (req, res, next) => {
  const { error, value } = registerSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true // remove campos extras (ex: telefone, chavePix, se vierem)
  })
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    })
  }
  req.body = value // substitui pelo objeto validado/limpo
  next()
}

const validateLogin = (req, res, next) => {
  const { error, value } = loginSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    })
  }
  req.body = value
  next()
}

const validateForgotPassword = (req, res, next) => {
  const { error, value } = forgotPasswordSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    })
  }
  req.body = value
  next()
}

const validateResetPassword = (req, res, next) => {
  const { error, value } = resetPasswordSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true
  })
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    })
  }
  req.body = value
  next()
}

module.exports = {
  validateRegister,
  validateLogin,
  validateForgotPassword,
  validateResetPassword
}
