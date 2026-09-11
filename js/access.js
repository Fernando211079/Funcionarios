import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const SETORES_PADRAO = ["Serigrafia","Corte","Estamparia","Plotter","Embalagem","Comercial","Administração","Resina","Digital"];

function app(){ return getApps().length ? getApps()[0] : initializeApp(firebaseConfig); }
function db(){ return getFirestore(app()); }
function auth(){ return getAuth(app()); }

// Projeto de perfil unico: qualquer conta autenticada no Firebase e o Gestor,
// com acesso a todos os setores. Nao existe mais Administrador, Gerente de
// Producao ou RH neste projeto.
export async function getPerfilAtual(){
  const user = auth().currentUser;
  if(!user) return null;
  return { uid:user.uid, email:user.email||"", nome:user.email||"", perfil:"gestor", ativo:true };
}

export async function listarSetores(){
  const snap = await getDocs(collection(db(), "setores"));
  const dbSetores = snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.ativo !== false).sort((a,b)=>(a.nome||"").localeCompare(b.nome||""));
  return dbSetores.length ? dbSetores : SETORES_PADRAO.map(nome=>({id:nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-"),nome,ativo:true}));
}

export async function salvarSetor(nome){
  const id=nome.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-");
  if(!id) throw new Error("Nome do setor invalido.");
  await setDoc(doc(db(),"setores",id),{nome:nome.trim(),ativo:true,atualizadoEm:new Date().toISOString()},{merge:true});
}
