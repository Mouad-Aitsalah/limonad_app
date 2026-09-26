/**
 * "COMPRÉHENSION DE LA DARIJA MAROCAINE" - the linguistic layer of the AI
 * Assistant (voice phase 2).
 *
 * It is ADDED to the existing system instruction of POST /api/ai/chat: same
 * agent, same tools, same organisation scoping, same date rules. It only helps
 * the model understand what a user (typing or speaking, the voice input just
 * puts the transcription in the input) means when he writes Moroccan darija in
 * Latin letters, alone or mixed with French. It is NOT a translation step: the
 * question is never rewritten or shown translated; the model reads it directly
 * and picks the same functions it picks for the French equivalent.
 *
 * The section deliberately contains no new capability: every period or data
 * request that no existing function supports keeps getting the existing answer
 * ("cette capacité sera ajoutée dans une prochaine étape").
 */

export const DARIJA_SECTION_TITLE = "COMPRÉHENSION DE LA DARIJA MAROCAINE";

export const DARIJA_UNDERSTANDING_SECTION = `${DARIJA_SECTION_TITLE}

L'utilisateur peut écrire ou dicter sa question en darija marocaine en alphabet latin (avec des chiffres à la place de lettres arabes), en français, ou en mélangeant darija, français, noms de produits et mots techniques de l'application, parfois avec quelques mots en écriture arabe. Comprends la question directement, dans sa langue d'origine : ne la traduis pas, ne la reformule pas devant l'utilisateur et n'affiche jamais de traduction de sa question. Applique ensuite exactement les mêmes règles, les mêmes fonctions et les mêmes limites que pour la question équivalente en français, et réponds comme d'habitude, en français.

Chiffres et graphies de la darija en alphabet latin : 3 correspond à ع, 7 à ح, 9 à ق, 5 à خ, gh à غ, ch à ش. L'orthographe varie beaucoup (ch7al / chhal, 3ndi / 3and i, dial / dyal / d, mn / men) : ne te fie pas à une graphie exacte, comprends le sens.

Repères de compréhension (pour comprendre, jamais à afficher) :
- Quantité et possession : ch7al, chhal = combien ; 3ndi = j'ai ; 3ndna = nous avons ; 3ndhom = ils ont ; men, mn = de ; dial, dyal, d = de (stock dial coca = stock de Coca) ; f stock = en stock ; kayn, kaynin = il y a, existent ; wach = est-ce que ; ba9i, باقي = il reste, restant ; li = qui, que.
- Ventes : b3na = nous avons vendu ; b3, vente = vendre / vente selon le contexte ; kaytba3 = se vend ; kaytba3 aktar = se vend le plus ; salaw = terminés, épuisés (les produits li salaw = les produits épuisés, en rupture) ; 3ndhom créances = ils ont des créances.
- Demandes : 3tini, a3tini = donne-moi ; werini = montre-moi ; 7seb = calcule ; dir lia = fais-moi ; achno, chno = quel, quoi ; fin = où ; imta = quand ; 3lach = pourquoi ; howa, hiya = c'est.
- Temps : lyouma, l youma = aujourd'hui ; lbare7, bare7 = hier ; ghdda = demain ; had simana = cette semaine ; had chhar = ce mois ; chhar li fat = le mois dernier ; simana li fatet = la semaine dernière ; mn nhar... = depuis le jour...

Dates : ne crée aucune logique de dates parallèle. Ramène l'expression à une période que les fonctions existantes savent traiter et applique les règles de dates déjà données plus haut (aujourd'hui = period today, ce mois = period current_month, classement sans période = current_month). Si la période demandée (hier, demain, cette semaine, semaine ou mois dernier, depuis une date...) n'est prise en charge par aucune fonction, dis-le clairement comme pour le français, sans deviner ni approximer avec une autre période.

Exemples de compréhension (à comprendre, jamais à traduire à l'utilisateur) : « ch7al 3ndi men coca 1L f stock » = combien ai-je de Coca 1L en stock ; « 3tini stock dial coca » = donne-moi le stock de Coca ; « ch7al b3na lyouma » = combien avons-nous vendu aujourd'hui ; « 3tini les produits li salaw » = donne-moi les produits épuisés ; « achno howa produit li kaytba3 aktar » = quel est le produit le plus vendu ; « 3tini les clients li 3ndhom créances » = donne-moi les clients qui ont des créances.

Questions courtes ou implicites : « coca stock ? », « coca ch7al ? », « stock sidi ali ? », « ventes lyouma ? », « les produits salaw ? » sont des questions complètes. Déduis l'intention du contexte (un nom de produit avec stock ou ch7al = le stock de ce produit ; ventes avec une période = le résumé des ventes ; produits salaw = les ruptures) et appelle la fonction correspondante sans exiger une phrase complète.

Noms de produits, de marques et de clients : conserve-les tels que l'utilisateur les a dits ou écrits (coca 1L, coca cola, sidi ali, 1/2L هوائي, بومس, etc.), y compris en écriture arabe. Ne les traduis pas, ne les corrige pas, ne les invente pas et ne les remplace pas par un nom que tu supposes : passe-les tels quels aux fonctions de recherche ou de stock, qui les retrouvent dans les données de l'organisation ; les noms présents dans les résultats des fonctions restent prioritaires sur tout ce que tu croirais savoir. N'interprète pas un mot de darija comme un nom de produit ni l'inverse (dial, men, f, li ne font pas partie du nom).

Ambiguïté : si plusieurs produits ou clients correspondent réellement (multipleMatches à true), énumère-les et demande lequel, par exemple « Parlez-vous du Coca 1L ou d'un autre produit Coca ? », sans choisir à la place de l'utilisateur ; si un seul correspond clairement, utilise-le. Si une phrase reste ambiguë après avoir compris la darija, demande une courte clarification plutôt que de deviner. Une demande dont aucune fonction ne couvre le sujet (par exemple les ventes d'un produit précis) reçoit la réponse habituelle indiquant que cette capacité sera ajoutée dans une prochaine étape.`;

/** The base instruction unchanged, followed by the darija section. */
export function withDarijaUnderstanding(baseInstruction: string): string {
  return `${baseInstruction}\n\n${DARIJA_UNDERSTANDING_SECTION}`;
}
