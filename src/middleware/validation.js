const Joi = require('joi');

// Schema para registro de usuário
const registerSchema = Joi.object({
    nome: Joi.string().min(3).max(100).required(),
    email: Joi.string().email().required(),
    telefone: Joi.string().pattern(/^[0-9]{10,11}$/).required(),
    cpf: Joi.string().pattern(/^[0-9]{11}$/).required(),
    chavePix: Joi.string().min(3).max(100).required(),
    tipoChavePix: Joi.string().valid('cpf', 'email', 'telefone', 'aleatoria').required(),
    senha: Joi.string()
        .min(8)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .message('Senha deve ter pelo menos 8 caracteres, uma letra maiúscula, uma minúscula e um número'),
    codigoConvite: Joi.string().optional().allow('')
});

// Schema para login
const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    senha: Joi.string().required()
});

// Schema para recuperação de senha
const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required()
});

// Schema para reset de senha
const resetPasswordSchema = Joi.object({
    token: Joi.string().required(),
    senha: Joi.string()
        .min(8)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .required()
});

// Middleware de validação para registro
const validateRegister = (req, res, next) => {
    const { error } = registerSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.details[0].message
        });
    }
    next();
};

// Middleware de validação para login
const validateLogin = (req, res, next) => {
    const { error } = loginSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.details[0].message
        });
    }
    next();
};

// Middleware de validação para forgot password
const validateForgotPassword = (req, res, next) => {
    const { error } = forgotPasswordSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.details[0].message
        });
    }
    next();
};

// Middleware de validação para reset password
const validateResetPassword = (req, res, next) => {
    const { error } = resetPasswordSchema.validate(req.body);
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.details[0].message
        });
    }
    next();
};

module.exports = {
    validateRegister,
    validateLogin,
    validateForgotPassword,
    validateResetPassword
};