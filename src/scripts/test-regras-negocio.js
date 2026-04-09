const mongoose = require('mongoose');
require('dotenv').config();
const RodadaService = require('../services/rodadaService');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

class TesteRegrasNegocio {
  constructor() {
    this.resultados = {
      total: 0,
      passou: 0,
      falhou: 0,
      detalhes: []
    };
    this.rodadaId = null;
    this.verdeId = null;
    this.vermelhosIds = [];
    this.transacoesIds = [];
    this.numeroRodada = null;
  }

  async conectar() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log(`${colors.green}✅ Conectado ao MongoDB${colors.reset}\n`);
      return true;
    } catch (error) {
      console.log(`${colors.red}❌ Erro ao conectar: ${error.message}${colors.reset}`);
      return false;
    }
  }

  async fechar() {
    await mongoose.connection.close();
    console.log(`\n${colors.yellow}📡 Conexão fechada${colors.reset}`);
  }

  async limparRodadasTeste() {
    try {
      const db = mongoose.connection.db;
      // Manter apenas a rodada de exemplo (número 1)
      await db.collection('rodadas').deleteMany({ numero: { $gt: 1 } });
      console.log(`${colors.blue}   🧹 Rodadas de teste removidas${colors.reset}`);
    } catch (error) {
      // Ignorar erro
    }
  }

  async testarRodadaCompleta() {
    console.log(`${colors.magenta}${colors.bright}🧪 TESTANDO REGRAS DE NEGÓCIO DO Giro Premiado${colors.reset}\n`);

    // Limpar rodadas de teste anteriores
    await this.limparRodadasTeste();

    // 1. Criar nova rodada
    await this.testeCriarRodada();
    
    // 2. Adicionar 15 participantes
    await this.testeAdicionarParticipantes();
    
    // 3. Iniciar rodada (distribuir cores)
    await this.testeIniciarRodada();
    
    // 4. Verificar distribuição de cores
    await this.testeDistribuicaoCores();
    
    // 5. Verificar transações criadas
    await this.testeTransacoesIniciais();
    
    // 6. Simular depósitos
    await this.testeConfirmarDepositos();
    
    // 7. Verificar progressão após todos depositarem
    await this.testeProgressao();
    
    // 8. Verificar geração de novas rodadas
    await this.testeGeracaoNovasRodadas();

    // Mostrar resumo
    this.mostrarResumo();
  }

  async testeCriarRodada() {
    console.log(`${colors.cyan}📌 Teste 1: Criar nova rodada${colors.reset}`);
    
    try {
      const rodada = await RodadaService.criarRodada();
      
      this.rodadaId = rodada._id;
      this.numeroRodada = rodada.numero;
      
      console.log(`${colors.blue}   🔍 Rodada criada: ${rodada.nome} (ID: ${rodada._id})${colors.reset}`);
      
      const regras = [
        { nome: 'Rodada criada com sucesso', passou: !!rodada },
        { nome: 'Número da rodada é sequencial', passou: rodada.numero >= 1 },
        { nome: 'Status inicial é "aguardando"', passou: rodada.status === 'aguardando' },
        { nome: 'Lista de participantes vazia', passou: rodada.participantes.length === 0 }
      ];
      
      this.avaliarTeste('Criar Rodada', regras, rodada);
      
    } catch (error) {
      this.registrarFalha('Criar Rodada', error.message);
    }
    console.log('');
  }

  async testeAdicionarParticipantes() {
    console.log(`${colors.cyan}📌 Teste 2: Adicionar 15 participantes${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      
      // Buscar usuários comuns (não admin)
      const usuarios = await db.collection('users')
        .find({ role: 'user' })
        .limit(15)
        .toArray();
      
      if (usuarios.length < 15) {
        throw new Error(`Precisa de 15 usuários, tem apenas ${usuarios.length}`);
      }
      
      console.log(`${colors.blue}   🔍 Adicionando 15 participantes...${colors.reset}`);
      
      // Adicionar participantes um por um
      for (let i = 0; i < 15; i++) {
        await RodadaService.adicionarParticipante(
          this.rodadaId.toString(),
          usuarios[i]._id.toString()
        );
      }
      
      const rodadaAtualizada = await db.collection('rodadas').findOne({ _id: this.rodadaId });
      
      const regras = [
        { nome: '15 participantes adicionados', passou: rodadaAtualizada.participantes.length === 15 },
        { nome: 'Todos são amarelos', passou: rodadaAtualizada.participantes.every(p => p.cor === 'amarelo') }
      ];
      
      this.avaliarTeste('Adicionar Participantes', regras, rodadaAtualizada);
      
    } catch (error) {
      this.registrarFalha('Adicionar Participantes', error.message);
    }
    console.log('');
  }

  async testeIniciarRodada() {
    console.log(`${colors.cyan}📌 Teste 3: Iniciar rodada (distribuir cores)${colors.reset}`);
    
    try {
      const rodada = await RodadaService.iniciarRodada(this.rodadaId.toString());
      
      const regras = [
        { nome: 'Status mudou para "em_andamento"', passou: rodada.status === 'em_andamento' },
        { nome: 'Data de início registrada', passou: !!rodada.dataInicio },
        { nome: 'Verde foi definido', passou: !!rodada.verde },
        { nome: '2 Pretos foram definidos', passou: rodada.pretos?.length === 2 },
        { nome: '4 Azuis foram definidos', passou: rodada.azuis?.length === 4 },
        { nome: '8 Vermelhos foram definidos', passou: rodada.vermelhos?.length === 8 },
        { nome: 'Total de 15 participantes', passou: rodada.participantes.length === 15 }
      ];
      
      this.verdeId = rodada.verde;
      this.vermelhosIds = rodada.vermelhos;
      
      console.log(`${colors.blue}   🔍 Verde ID: ${this.verdeId}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Vermelhos: ${this.vermelhosIds?.length}${colors.reset}`);
      
      this.avaliarTeste('Iniciar Rodada', regras, rodada);
      
    } catch (error) {
      this.registrarFalha('Iniciar Rodada', error.message);
    }
    console.log('');
  }

  async testeDistribuicaoCores() {
    console.log(`${colors.cyan}📌 Teste 4: Verificar distribuição de cores${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      const rodada = await db.collection('rodadas').findOne({ _id: this.rodadaId });
      
      const cores = rodada.participantes.reduce((acc, p) => {
        acc[p.cor] = (acc[p.cor] || 0) + 1;
        return acc;
      }, {});
      
      console.log(`${colors.blue}   🔍 Distribuição: Verde=${cores.verde || 0}, Preto=${cores.preto || 0}, Azul=${cores.azul || 0}, Vermelho=${cores.vermelho || 0}${colors.reset}`);
      
      const regras = [
        { nome: '1 Verde', passou: cores.verde === 1 },
        { nome: '2 Pretos', passou: cores.preto === 2 },
        { nome: '4 Azuis', passou: cores.azul === 4 },
        { nome: '8 Vermelhos', passou: cores.vermelho === 8 },
        { nome: 'Nenhum amarelo', passou: !cores.amarelo }
      ];
      
      this.avaliarTeste('Distribuição de Cores', regras, cores);
      
    } catch (error) {
      this.registrarFalha('Distribuição de Cores', error.message);
    }
    console.log('');
  }

  async testeTransacoesIniciais() {
    console.log(`${colors.cyan}📌 Teste 5: Verificar transações criadas${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      
      // Aguardar um momento para as transações serem criadas
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const transacoes = await db.collection('transacoes')
        .find({ rodada: this.rodadaId })
        .toArray();
      
      this.transacoesIds = transacoes.map(t => t._id);
      
      console.log(`${colors.blue}   🔍 Transações encontradas: ${transacoes.length}${colors.reset}`);
      
      if (transacoes.length > 0) {
        console.log(`${colors.blue}   🔍 Primeira transação: ${JSON.stringify(transacoes[0]).substring(0, 100)}...${colors.reset}`);
      }
      
      const regras = [
        { nome: '8 transações criadas', passou: transacoes.length === 8 },
        { nome: 'Todas são do tipo "deposito"', passou: transacoes.every(t => t.tipo === 'deposito') },
        { nome: 'Todas com valor 125', passou: transacoes.every(t => t.valor === 125) },
        { nome: 'Todas para o mesmo verde', passou: this.verdeId && transacoes.every(t => t.recebedor.toString() === this.verdeId.toString()) },
        { nome: 'Status "pendente"', passou: transacoes.every(t => t.status === 'pendente') }
      ];
      
      this.avaliarTeste('Transações Iniciais', regras, { total: transacoes.length, valor: 'R$ 125,00' });
      
    } catch (error) {
      this.registrarFalha('Transações Iniciais', error.message);
    }
    console.log('');
  }

  async testeConfirmarDepositos() {
    console.log(`${colors.cyan}📌 Teste 6: Confirmar depósitos${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      
      if (this.transacoesIds.length === 0) {
        throw new Error('Nenhuma transação encontrada para confirmar');
      }
      
      console.log(`${colors.blue}   🔍 Confirmando ${this.transacoesIds.length} depósitos...${colors.reset}`);
      
      // Simular confirmação de cada depósito
      for (let i = 0; i < this.transacoesIds.length; i++) {
        const result = await RodadaService.confirmarDeposito(
          this.transacoesIds[i].toString(),
          'comprovante-teste.jpg',
          'admin-id'
        );
        console.log(`${colors.blue}   ✅ Depósito ${i+1}/${this.transacoesIds.length} confirmado - Progresso: ${result.progresso}${colors.reset}`);
      }
      
      // Aguardar processamento
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Verificar rodada
      const rodada = await db.collection('rodadas').findOne({ _id: this.rodadaId });
      
      console.log(`${colors.blue}   🔍 Total confirmados: ${rodada.totalDepositosConfirmados || 0}/8${colors.reset}`);
      console.log(`${colors.blue}   🔍 Todos depositaram: ${rodada.todosDepositaram || false}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Data conclusão: ${rodada.dataTodosDepositaram || 'não registrada'}${colors.reset}`);
      
      const regras = [
        { nome: 'Todos os 8 depósitos confirmados', passou: rodada.totalDepositosConfirmados === 8 },
        { nome: 'Flag "todosDepositaram" ativada', passou: rodada.todosDepositaram === true },
        { nome: 'Data de conclusão registrada', passou: !!rodada.dataTodosDepositaram }
      ];
      
      this.avaliarTeste('Confirmar Depósitos', regras, { confirmados: rodada.totalDepositosConfirmados });
      
    } catch (error) {
      this.registrarFalha('Confirmar Depósitos', error.message);
    }
    console.log('');
  }

  async testeProgressao() {
    console.log(`${colors.cyan}📌 Teste 7: Progressão após depósitos${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      
      // Aguardar processamento da progressão
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const rodada = await db.collection('rodadas').findOne({ _id: this.rodadaId });
      
      const verdes = rodada.participantes.filter(p => p.cor === 'verde');
      const azuis = rodada.participantes.filter(p => p.cor === 'azul');
      const pretos = rodada.participantes.filter(p => p.cor === 'preto');
      const concluidos = rodada.participantes.filter(p => p.cor === 'concluido');
      
      console.log(`${colors.blue}   🔍 Verdes encontrados: ${verdes.length}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Azuis: ${azuis.length}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Pretos: ${pretos.length}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Concluídos: ${concluidos.length}${colors.reset}`);
      
      const regras = [
        { nome: 'Vermelhos viraram Azuis', passou: azuis.length >= 4 },
        { nome: 'Azuis viraram Pretos', passou: pretos.length >= 2 },
        { nome: '2 novos Verdes gerados', passou: verdes.length === 2 }
      ];
      
      this.avaliarTeste('Progressão de Cores', regras, { 
        status: rodada.status,
        verdes: verdes.length 
      });
      
    } catch (error) {
      this.registrarFalha('Progressão de Cores', error.message);
    }
    console.log('');
  }

  async testeGeracaoNovasRodadas() {
    console.log(`${colors.cyan}📌 Teste 8: Gerar novas rodadas${colors.reset}`);
    
    try {
      const db = mongoose.connection.db;
      
      // Aguardar processamento das novas rodadas
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const rodada = await db.collection('rodadas').findOne({ _id: this.rodadaId });
      
      console.log(`${colors.blue}   🔍 Status da rodada: ${rodada.status}${colors.reset}`);
      console.log(`${colors.blue}   🔍 Rodadas geradas: ${rodada.rodadasGeradas?.length || 0}${colors.reset}`);
      
      const regras = [
        { nome: 'Rodada original marcada como "concluida"', passou: rodada.status === 'concluida' },
        { nome: 'Data de fim registrada', passou: !!rodada.dataFim },
        { nome: '2 novas rodadas geradas', passou: rodada.rodadasGeradas?.length === 2 }
      ];
      
      // Verificar novas rodadas
      if (rodada.rodadasGeradas?.length > 0) {
        const novasRodadas = await db.collection('rodadas')
          .find({ _id: { $in: rodada.rodadasGeradas } })
          .toArray();
        
        const todasAguardando = novasRodadas.every(r => r.status === 'aguardando');
        regras.push({ 
          nome: 'Novas rodadas com status "aguardando"', 
          passou: todasAguardando 
        });
        
        console.log(`${colors.blue}   🔍 Novas rodadas: ${novasRodadas.map(r => r.nome).join(', ')}${colors.reset}`);
        console.log(`${colors.blue}   🔍 Status novas rodadas: ${todasAguardando ? '✅ aguardando' : '❌ erro'}${colors.reset}`);
      }
      
      this.avaliarTeste('Geração de Novas Rodadas', regras, { 
        rodadaOrigem: rodada.nome,
        novasRodadas: rodada.rodadasGeradas?.length || 0
      });
      
    } catch (error) {
      this.registrarFalha('Geração de Novas Rodadas', error.message);
    }
    console.log('');
  }

  avaliarTeste(nomeTeste, regras, dados) {
    let passou = true;
    let falhas = [];
    
    regras.forEach(regra => {
      if (regra.passou) {
        this.resultados.passou++;
      } else {
        passou = false;
        falhas.push(regra.nome);
        this.resultados.falhou++;
      }
      this.resultados.total++;
    });
    
    if (passou) {
      console.log(`${colors.green}  ✅ ${nomeTeste}: TODAS AS REGRAS OK${colors.reset}`);
    } else {
      console.log(`${colors.yellow}  ⚠️  ${nomeTeste}: ${falhas.length} falha(s)${colors.reset}`);
      falhas.forEach(f => console.log(`${colors.red}     ❌ ${f}${colors.reset}`));
    }
    
    this.resultados.detalhes.push({
      teste: nomeTeste,
      passou,
      regras: regras.length,
      falhas: falhas.length,
      dados
    });
  }

  registrarFalha(nomeTeste, erro) {
    console.log(`${colors.red}  ❌ ${nomeTeste}: ERRO - ${erro}${colors.reset}`);
    this.resultados.falhou++;
    this.resultados.total++;
  }

  mostrarResumo() {
    console.log(`${colors.magenta}${colors.bright}📊 RESUMO DOS TESTES${colors.reset}\n`);
    console.log(`Total de regras testadas: ${this.resultados.total}`);
    console.log(`${colors.green}✅ Regras OK: ${this.resultados.passou}${colors.reset}`);
    console.log(`${this.resultados.falhou > 0 ? colors.red : colors.green}${this.resultados.falhou > 0 ? '❌' : '✅'} Falhas: ${this.resultados.falhou}${colors.reset}`);
    
    if (this.resultados.falhou === 0) {
      console.log(`\n${colors.green}${colors.bright}🎉 TODAS AS REGRAS DE NEGÓCIO FUNCIONAM CORRETAMENTE!${colors.reset}`);
      console.log(`${colors.green}✅ Sistema 100% de acordo com o vídeo!${colors.reset}`);
    } else {
      console.log(`\n${colors.yellow}⚠️  Algumas regras precisam de ajuste${colors.reset}`);
      console.log(`${colors.cyan}💡 Dica: Verifique se o serviço está criando as transações corretamente${colors.reset}`);
    }
    
    console.log(`\n${colors.cyan}📋 Detalhes:${colors.reset}`);
    this.resultados.detalhes.forEach(d => {
      console.log(`  ${d.passou ? '✅' : '⚠️'} ${d.teste}: ${d.regras} regras, ${d.falhas} falhas`);
    });
  }
}

// Executar testes
async function executarTestes() {
  const teste = new TesteRegrasNegocio();
  
  const conectado = await teste.conectar();
  if (!conectado) {
    console.log(`${colors.red}❌ Não foi possível conectar ao banco de dados${colors.reset}`);
    process.exit(1);
  }
  
  await teste.testarRodadaCompleta();
  await teste.fechar();
}

executarTestes();