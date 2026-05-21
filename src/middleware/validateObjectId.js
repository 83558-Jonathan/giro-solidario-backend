const mongoose = require('mongoose');

/**
 * Middleware para validar ObjectIds em parâmetros de rota e corpo da requisição.
 * Não lança exceções se os campos não existirem.
 */
function validateObjectId(req, res, next) {
  // Lista de campos que podem conter IDs
  const camposPossiveis = ['id', 'transacaoId', 'rodadaId', 'usuarioId', 'solicitacaoId'];

  // Garantir que req.params e req.body existam (segurança extra)
  const params = req.params || {};
  const body = req.body || {};

  for (const campo of camposPossiveis) {
    // Verifica primeiro em req.params
    let valor = params[campo];
    if (valor !== undefined && valor !== null) {
      if (!mongoose.Types.ObjectId.isValid(valor.toString())) {
        return res.status(400).json({ success: false, error: `ID inválido: ${campo}` });
      }
      continue; // já validou, pula para o próximo campo
    }

    // Verifica depois em req.body
    valor = body[campo];
    if (valor !== undefined && valor !== null && typeof valor === 'string') {
      if (!mongoose.Types.ObjectId.isValid(valor)) {
        return res.status(400).json({ success: false, error: `ID inválido: ${campo}` });
      }
    }
  }

  next();
}

module.exports = validateObjectId;