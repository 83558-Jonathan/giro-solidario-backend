const SolicitacaoSaque = require('../models/SolicitacaoSaque')

exports.getMinhasSolicitacoes = async (req, res) => {
  try {
    const solicitacoes = await SolicitacaoSaque.find({ usuario: req.usuarioId })
      .populate('rodada', 'nome numero status')
      .sort({ dataSolicitacao: -1 })
    res.json({ success: true, data: solicitacoes })
  } catch (error) {
    console.error('Erro ao buscar solicitações:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
