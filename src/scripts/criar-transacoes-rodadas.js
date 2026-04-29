// criar-transacoes-rodadas.js
const mongoose = require("mongoose");
require("dotenv").config();
const Rodada = require("../models/Rodada");
const Transacao = require("../models/Transacao");
const User = require("../models/User");

async function main() {
  await mongoose.connect("mongodb://localhost:27017/giro-solidario");
  console.log("✅ Conectado\n");

  // Buscar rodadas em andamento
  const rodadas = await Rodada.find({ status: "em_andamento" });

  for (const rodada of rodadas) {
    console.log(`📋 Processando ${rodada.nome}...`);

    // Verificar transações existentes
    const existentes = await Transacao.countDocuments({ rodada: rodada._id });
    console.log(`   Transações existentes: ${existentes}`);

    if (existentes === 0 && rodada.vermelhos && rodada.vermelhos.length > 0) {
      console.log(`   Criando ${rodada.vermelhos.length} transações...`);

      const verdeId = rodada.verde;
      const valor = 150;

      for (const vermelhoId of rodada.vermelhos) {
        // Buscar nome do usuário
        const usuario = await User.findById(vermelhoId);

        const transacao = new Transacao({
          tipo: "deposito",
          pagador: vermelhoId,
          recebedor: verdeId,
          valor: valor,
          rodada: rodada._id,
          status: "pendente",
        });
        await transacao.save();

        // Associar ao participante
        const participante = rodada.participantes.find(
          (p) => p.usuario.toString() === vermelhoId.toString(),
        );
        if (participante) {
          participante.transacaoId = transacao._id;
          participante.depositoConfirmado = false;
        }

        console.log(
          `      ✅ Transação criada para ${usuario?.nome || vermelhoId} (R$ ${valor})`,
        );
      }

      await rodada.save();
      console.log(
        `   ✅ ${rodada.vermelhos.length} transações criadas (R$ ${valor} cada)!\n`,
      );
    } else if (existentes > 0) {
      console.log(`   ✅ Transações já existem\n`);
    } else {
      console.log(`   ⚠️ Nenhum vermelho encontrado\n`);
    }
  }

  // Resumo
  const totalTransacoes = await Transacao.countDocuments();
  const transacoesPendentes = await Transacao.countDocuments({
    status: "pendente",
  });
  const valorTotalPendente = transacoesPendentes * 150; // ✅ AJUSTADO: cálculo com novo valor

  console.log(`📊 RESUMO:`);
  console.log(`   Total de transações: ${totalTransacoes}`);
  console.log(`   Pendentes: ${transacoesPendentes}`);
  console.log(`   Valor total pendente: R$ ${valorTotalPendente.toFixed(2)}`);

  await mongoose.disconnect();
  console.log("\n✅ Concluído! Agora execute pagar-todos-vermelhos.js");
}

main();
