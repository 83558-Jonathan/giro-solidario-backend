const mongoose = require('mongoose');

function validateObjectId(paramNames = []) {
  return (req, res, next) => {
    const defaultFields = ['id', 'rodadaId', 'transacaoId', 'usuarioId', 'solicitacaoId'];
    const fieldsToCheck = paramNames.length > 0 ? paramNames : defaultFields;

    // Verificar em req.params (sempre existe, mas pode não ter a chave)
    for (const field of fieldsToCheck) {
      const value = req.params[field];
      if (value !== undefined && value !== null) {
        if (!mongoose.Types.ObjectId.isValid(value.toString())) {
          return res.status(400).json({ success: false, error: `ID inválido: ${field}` });
        }
      }
    }

    // Verificar em req.body (pode ser undefined em GET, etc.)
    if (req.body && typeof req.body === 'object') {
      for (const field of fieldsToCheck) {
        const value = req.body[field];
        if (value !== undefined && value !== null && typeof value === 'string') {
          if (!mongoose.Types.ObjectId.isValid(value)) {
            return res.status(400).json({ success: false, error: `ID inválido: ${field}` });
          }
        }
      }
    }

    next();
  };
};

module.exports = validateObjectId;