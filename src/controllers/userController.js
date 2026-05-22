const User = require('../models/User')
const mongoose = require('mongoose')

exports.listarUsuarios = async (req, res) => {
  try {
    const usuarios = await User.find().select('-senha').sort({ nome: 1 })
    res.json({ success: true, count: usuarios.length, data: usuarios })
  } catch (error) {
    console.error('❌ Erro ao listar usuários:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.buscarUsuario = async (req, res) => {
  try {
    const usuario = await User.findById(req.params.id).select('-senha')
    if (!usuario)
      return res
        .status(404)
        .json({ success: false, error: 'Usuário não encontrado' })
    res.json({ success: true, data: usuario })
  } catch (error) {
    console.error('❌ Erro ao buscar usuário:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.atualizarUsuario = async (req, res) => {
  try {
    if (
      req.params.id !== req.usuarioId.toString() &&
      req.usuario.role !== 'admin'
    )
      return res
        .status(403)
        .json({ success: false, error: 'Não autorizado a editar este usuário' })
    const { nome, telefone, chavePix, tipoChavePix } = req.body
    const updateData = {}
    if (nome) updateData.nome = nome
    if (telefone) updateData.telefone = telefone
    if (chavePix) updateData.chavePix = chavePix
    if (tipoChavePix) updateData.tipoChavePix = tipoChavePix
    const usuario = await User.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    }).select('-senha')
    if (!usuario)
      return res
        .status(404)
        .json({ success: false, error: 'Usuário não encontrado' })
    res.json({ success: true, data: usuario })
  } catch (error) {
    console.error('❌ Erro ao atualizar usuário:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

exports.listarIndicados = async (req, res) => {
  try {
    const indicados = await User.find({ indicadoPor: req.params.id }).select(
      'nome email createdAt'
    )
    res.json({ success: true, count: indicados.length, data: indicados })
  } catch (error) {
    console.error('❌ Erro ao listar indicados:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
