import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, runTransaction, onSnapshot, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { getPerfilAtual } from "./access.js";
const COLLECTION="funcionarios", CP_COLLECTION="comunicacoes_pessoal", STORAGE_KEY="funcionariosStorage";
let db=null,auth=null,app=null;
export function initFirebase(){if(!app)app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);if(!db)db=getFirestore(app);if(!auth)auth=getAuth(app);if(!firebaseConfig?.apiKey||firebaseConfig.apiKey==="SUA_API_KEY")throw new Error("Configure js/firebase-config.js com os dados do seu projeto Firebase.");return db;}
export function obterAuth(){initFirebase();return auth;}
export async function aguardarLogin(){initFirebase();if(auth.currentUser)return auth.currentUser;return new Promise((resolve,reject)=>{let done=false;const unsub=onAuthStateChanged(auth,u=>{if(done)return;done=true;unsub();if(u)resolve(u);else reject(new Error("Sessão não encontrada. Faça login para continuar."));},reject)});}
async function banco(){await aguardarLogin();return db;}
async function perfil(){await banco();return getPerfilAtual();}

// Projeto de perfil único (só Gestor): não há mais restrição por setor nem
// fluxo de aprovação entre Gerente de Produção e RH. Tudo o que é criado já
// fica disponível para consulta.
export async function listarFuncionarios(){
  const b=await banco();
  const s=await getDocs(query(collection(b,COLLECTION)));
  return s.docs.map(d=>({id:d.id,...d.data()}));
}
export async function obterFuncionario(id){if(!id)return null;const b=await banco();const s=await getDoc(doc(b,COLLECTION,id));if(!s.exists())return null;return {id:s.id,...s.data()};}
function normalizarSetor(dados){const setor=(dados.setorTrabalho||dados.setor||"").trim();if(!setor)throw new Error("Selecione um setor para o funcionário.");return setor;}
export async function adicionarFuncionario(dados){const b=await banco();const setor=normalizarSetor(dados);const r=await addDoc(collection(b,COLLECTION),{...dados,setorTrabalho:setor,setorId:setor,criadoPor:obterAuth().currentUser.uid,atualizadoEm:new Date().toISOString()});return r.id;}
export async function atualizarFuncionario(id,dados){if(!id)throw new Error("Identificador do funcionário não informado.");const b=await banco();const atual=await obterFuncionario(id);if(!atual)throw new Error("Funcionário não encontrado.");const informouSetor=dados.setorTrabalho!==undefined||dados.setor!==undefined;const setor=informouSetor?normalizarSetor(dados):(atual.setorTrabalho||atual.setorId);await updateDoc(doc(b,COLLECTION,id),{...dados,...(setor?{setorTrabalho:setor,setorId:setor}:{}),atualizadoEm:new Date().toISOString()});}
export async function excluirFuncionario(id){if(!id)throw new Error("Identificador do funcionário não informado.");const b=await banco();if(!await obterFuncionario(id))throw new Error("Funcionário não encontrado.");await deleteDoc(doc(b,COLLECTION,id));}
export async function proximoNumeroCP(){const b=await banco(),ref=doc(b,"configuracoes","numeracao_cp");return runTransaction(b,async tx=>{const s=await tx.get(ref);const atual=s.exists()?Number(s.data().ultimoNumero||0):0;const proximo=atual+1;tx.set(ref,{ultimoNumero:proximo,atualizadoEm:new Date().toISOString()},{merge:true});return String(proximo).padStart(4,'0')});}

// Agora a CP já nasce registrada, sem etapa de aprovação — fica salva só para
// consulta do Gestor no histórico.
export async function salvarCP(dados){
  const b=await banco(),p=await perfil();
  const setor=(dados.setor||dados.setorTrabalho||"").trim();
  if(!setor) throw new Error("Informe o setor da CP.");
  const numero=dados.numero||await proximoNumeroCP();
  const uid=obterAuth().currentUser.uid;
  const agora=new Date().toISOString();
  const historico=[{acao:'CP registrada',status:'Registrada',por:uid,perfil:p?.perfil||'gestor',nome:p?.nome||p?.email||'',data:agora}];
  const r=await addDoc(collection(b,CP_COLLECTION),{
    ...dados, setor, setorId:setor, numero, criadoPor:uid, criadoEm:agora, atualizadoEm:agora,
    statusCP:'Registrada', statusEnvio:'Registrada',
    historico
  });
  return r.id;
}
export async function atualizarCP(id,dados){
  const b=await banco();
  const atual=await obterCP(id);
  if(!atual) throw new Error("CP não encontrada.");
  const setor=(dados.setor||atual.setor||"").trim();
  await updateDoc(doc(b,CP_COLLECTION,id),{...dados,setor,setorId:setor,atualizadoEm:new Date().toISOString()});
}
export async function adicionarObservacaoCP(id,texto){
  if(!id||!texto?.trim()) throw new Error("Informe o texto da observação.");
  const b=await banco(),p=await perfil();
  const cp=await obterCP(id);
  if(!cp) throw new Error("CP não encontrada.");
  const agora=new Date().toISOString();
  const entrada={acao:'Observação',status:cp.statusCP||'',por:obterAuth().currentUser.uid,nome:p?.nome||p?.email||'Gestor',perfil:p?.perfil||'gestor',observacao:texto.trim(),data:agora};
  await updateDoc(doc(b,CP_COLLECTION,id),{historico:arrayUnion(entrada),atualizadoEm:agora});
  return entrada;
}
export async function listarHistoricoCP(id){
  const c=await obterCP(id);
  return c?.historico||[];
}
export async function obterCP(id){
  const b=await banco();
  const s=await getDoc(doc(b,CP_COLLECTION,id));
  if(!s.exists())return null;
  return {id:s.id,...s.data()};
}
function ordenarCPs(lista){
  return [...lista].sort((a,b)=>String(b.criadoEm||b.atualizadoEm||'').localeCompare(String(a.criadoEm||a.atualizadoEm||'')));
}
export function descreverErroFirestore(err){
  if(!err) return '';
  const codigo=String(err.code||'');
  if(codigo.includes('permission-denied')) return 'Permissão negada pelas regras do Firestore. Publique o arquivo firestore.rules atualizado no Console do Firebase (Firestore > Regras > Publicar).';
  if(codigo.includes('failed-precondition')) return 'O Firestore precisa criar um índice para esta consulta. Abra o console do navegador (F12) e clique no link "create index" que aparece no erro.';
  if(codigo.includes('unauthenticated')) return 'Sessão expirada. Faça login novamente.';
  return err.message||String(err);
}
export async function listarCPs(){
  const b=await banco();
  const s=await getDocs(query(collection(b,CP_COLLECTION)));
  return ordenarCPs(s.docs.map(d=>({id:d.id,...d.data()})));
}
export async function listarUltimasCPs(qtd=30){
  const lista=await listarCPs();
  return lista.slice(0,qtd);
}
export async function observarCPs(callback,qtd=50){
  const b=await banco();
  return onSnapshot(query(collection(b,CP_COLLECTION)),s=>{
    const lista=ordenarCPs(s.docs.map(d=>({id:d.id,...d.data()})));
    callback(lista.slice(0,qtd),null,null);
  },err=>{
    console.error('Falha na consulta de CPs:',err);
    callback([],null,err);
  });
}
export async function migrarLocalStorageSeNecessario(){const bruto=localStorage.getItem(STORAGE_KEY);if(!bruto)return;let lista;try{lista=JSON.parse(bruto)}catch{localStorage.removeItem(STORAGE_KEY);return}if(!Array.isArray(lista)||!lista.length){localStorage.removeItem(STORAGE_KEY);return}const existentes=await listarFuncionarios();if(existentes.length){localStorage.removeItem(STORAGE_KEY);return}for(const funcionario of lista)await adicionarFuncionario(funcionario);localStorage.removeItem(STORAGE_KEY);}
export async function iniciarApp(){initFirebase();await aguardarLogin();await migrarLocalStorageSeNecessario();}
