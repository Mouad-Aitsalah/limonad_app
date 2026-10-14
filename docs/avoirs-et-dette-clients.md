# Avoirs clients / fournisseurs, dette client et tests de base de données

Ce document décrit **uniquement ce que le code fait aujourd'hui** (lots 1 et 2 de la refonte des avoirs et fermeture des retours chauffeur). Chaque règle renvoie au fichier qui l'applique. Ce qui n'est pas encore fait (interface du lot 3, activation de la date de bascule) est signalé comme tel.

## 1. Vue d'ensemble

Un avoir (`CreditNote`, `lib/server/credit-notes.ts`) enregistre un retour de marchandises, côté **client** (`partyType = CUSTOMER`) ou côté **fournisseur** (`SUPPLIER`).

| Élément | Fonctionnement |
|---|---|
| Écran | `/avoirs` (liste, saisie) et `/avoirs/[id]` (détail), derrière le module `creditNotes` |
| Menu | « Avoir client / fournisseur » visible pour `admin` et `cashier` (`components/layout/nav-items.ts`) ; un `depot_manager` accède à la page par son adresse |
| API | `/api/credit-notes` (liste), `/draft`, `/manual`, `/[id]` , `/[id]/validate`, `/[id]/reverse`, `/returnables` |
| Rôles « bureau » | `admin`, `depot_manager`, `cashier` : créer, enregistrer un brouillon, valider, consulter |
| Contre-passation | `admin` et `depot_manager` uniquement |
| Chauffeurs | aucun accès, voir §6 |

### Cycle de vie

1. **Brouillon** (`DRAFT`) : enregistré sans effet sur le stock ni la comptabilité.
2. **Validé** (`VALIDATED`) : posé par `validateCreditNote`, ou directement à la création (`createManualCreditNote`). La validation, dans une transaction `Serializable` :
   - n'accepte qu'un brouillon (une seconde validation simultanée échoue) ;
   - mouvement de stock : un avoir **client** réintègre le stock du dépôt de destination, un avoir **fournisseur** le sort du dépôt source ;
   - renseigne `validatedAt` (horloge du serveur), `validatedByUserId` ;
   - poste l'écriture comptable (§3) et une ligne d'audit.
3. **Contre-passé** (`REVERSED`) : `reverseCreditNote` ajoute des mouvements de stock inverses (les mouvements d'origine ne sont jamais modifiés), contre-passe l'écriture comptable et trace l'audit. Elle est refusée si le stock à reprendre n'est plus disponible.

Un avoir client peut être **lié à une facture** (`returnMode = LINKED`, chaque ligne référence une ligne de vente, quantité plafonnée par ce qui reste retournable, re-vérifié à la validation) ou **manuel** (`MANUAL`, sans facture).

### Protections à la saisie et à la validation (lot 1)

- **Justification** : un avoir client exige un commentaire d'au moins 5 caractères (`CREDIT_NOTE_JUSTIFICATION_MIN_LENGTH`), pour tous les rôles, à la création et à la validation.
- **Dépôt uniquement** : un avoir client doit réintégrer un *dépôt*, un avoir fournisseur sortir d'un *dépôt* ; un camion est refusé (`assertDepotLocation`), côté serveur, à la création et à la validation.
- **Clé d'idempotence obligatoire** pour tout nouvel avoir (sans `id` de brouillon) : un double clic ou une nouvelle tentative réseau renvoie l'avoir déjà créé au lieu d'en créer (et d'en rembourser) un second. Un appelant d'API sans clé reçoit 422.
- **Caissier** : sur un retour sans facture, le serveur impose le prix catalogue du produit (prix de vente HT, aucune remise, TVA du produit), quoi que le navigateur envoie. À la validation d'un brouillon client, un caissier est refusé (403) si une ligne sans facture diffère du catalogue ; rien n'est recalculé. `admin` et `depot_manager` ne sont pas restreints ; les lignes liées à une facture et les avoirs fournisseur sont exemptés.
- **Mode de remboursement** (`refundMode`) : voir §2. Un avoir fournisseur garde `CASH`.

## 2. Remboursement en espèces ou avoir sur compte client

Le champ `CreditNote.refundMethod` vaut `CASH` ou `BANK` ; l'interface expose `refundMode` :

| `refundMode` (saisie) | `refundMethod` | Sens | Défaut |
|---|---|---|---|
| `remboursement_especes` | `CASH` | l'argent est rendu au client depuis la caisse | oui |
| `avoir_sur_compte` | `BANK` | le montant est crédité au compte du client | non |

Libellé affiché pour `BANK` : **« Avoir sur compte client »** (`refundMethodLabel` dans `components/dashboard/receivables/receivables-format.ts`) ; pour `CASH` : « Espèces ».

## 3. Écriture comptable d'un avoir

Posée à la validation par `postValidatedCreditNoteAccountingEntry` (`lib/server/accounting.ts`) :

- **Client, `CASH`** : structure fixe 7111 / 117 / 117 / 51611 (montants TTC), la part d'arrondi éventuelle sur sa propre ligne.
- **Client, `BANK`** : 7119 (HT) + TVA (si > 0) au débit, compte client au crédit, plus la ligne d'arrondi éventuelle. Le crédit va au compte client **générique** défini dans les paramètres comptables, pas au compte auxiliaire du client.
- **Fournisseur** : `CASH` → 4411 / 6111 / 34552 ; autre méthode → comptes fournisseur et retour des paramètres comptables.

Les avoirs fournisseur ne sont concernés ni par la règle de dette ni par la bascule (§4).

## 4. Règle de dette client et `CASH_REFUND_DEBT_CUTOVER_ISO`

### Formule

`computeCustomerDebt` (`lib/server/customer-debt.ts`) :

```
dette = max(0, ventes à crédit − avoirs clients validés qui réduisent la dette − règlements validés)
```

`loadCustomerBalances` et la vue Créances (`lib/server/receivables-core.ts`) construisent le **même** filtre d'avoirs à partir de `lib/credit-note-debt-rule.ts`, pour que les deux calculs ne puissent pas diverger. Tout ce qui lit la dette en bénéficie : Solde clients, tableau de bord (KPI, créances, meilleurs clients), plafond de crédit des ventes comptoir / chauffeur / en attente, règlements clients, annulation et révision d'une vente, assistant IA. Le champ en cache `Customer.currentBalance` n'est pas modifié par ces lots.

### Règle

Un avoir **client validé** réduit la dette si :

- il est en `BANK` (avoir sur compte) ; ou
- son `validatedAt` est vide ; ou
- son `validatedAt` est **antérieur** à la date de bascule.

Un avoir `CASH` validé **à partir de** la date de bascule ne réduit **pas** la dette : l'argent sort de la caisse, la dette à crédit est une affaire distincte (500 DH dus, 100 DH remboursés en espèces : la dette reste 500). Brouillons et avoirs contre-passés ne comptent jamais ; les avoirs fournisseur ne sont pas concernés. La comparaison utilise `validatedAt` (horloge du serveur), jamais `createdAt` (date de retour saisie).

### La constante

`CASH_REFUND_DEBT_CUTOVER_ISO` (`lib/credit-note-debt-rule.ts`) :

- **vaut `null` aujourd'hui** : la règle est *dormante*, tout avoir client validé réduit la dette, les chiffres sont ceux d'avant les lots ;
- contrôlée au chargement du module : tout texte qui n'est pas un instant UTC `YYYY-MM-DDTHH:mm:ssZ`, ou antérieur à `LEGACY_CREDIT_NOTE_VALIDATION_FLOOR` (2026-10-13T14:57:36Z, juste après la dernière validation historique connue au moment de la conception), fait échouer le chargement (donc le build et les tests) au lieu de fausser des soldes ;
- seuls les tests passent une date par l'option `{ cutover }` ; aucun code de production ne le fait.

### Ce qui change à l'écran quand la règle est active

Champs ajoutés **seulement** quand une date est définie : `cashRefundsNotDeductedTotal` (dette d'un client), `dataNotes.cashRefundsNotDeducted` (vue d'ensemble), `cashRefundsNotDeducted` et, par mouvement, `creditNote.notDeductedFromDebt` (détail client, effet 0 sur le solde). La vue Créances affiche alors la note « n remboursement(s) en espèces … non déduit(s) du solde » et le libellé « Avoirs déduits ».

### Avoirs historiques

Les avoirs validés avant la bascule gardent leur effet sur la dette. Données de production examinées le 2026-10-14 (sauvegarde locale, lecture seule) : 4 avoirs clients, tous `CASH`, validés entre 2026-08-15 et 2026-10-13T14:57:35Z. Appliquer la règle rétroactivement à ces avoirs aurait relevé la dette de 2 clients (1 128,00 DH au total) ; c'est ce que le plancher interdit.

## 5. Procédure d'activation de la date de bascule

La date n'est **pas** renseignée. Pour l'activer, au moment de la mise en production :

1. Publier ensemble le code des lots 1 et 2 (l'écran offre déjà le choix du mode de remboursement) ; ne pas activer la date dans un déploiement antérieur.
2. Avant la fusion, vérifier en **lecture seule** sur la production que le dernier avoir client validé a un `validatedAt` antérieur à l'instant choisi.
3. Choisir un instant UTC égal ou postérieur à la mise en ligne, par exemple `"2026-11-02T08:30:00Z"`, et le confirmer.
4. Modifier l'unique ligne `export const CASH_REFUND_DEBT_CUTOVER_ISO` ; aucune migration, aucune donnée à corriger.
5. Déployer. Après le déploiement, vérifier qu'aucun avoir `CASH` n'a été validé entre la mise en ligne et l'instant choisi (il réduirait encore la dette).
6. Un retour arrière (redéploiement de l'ancienne version) désactive la règle : les avoirs espèces validés pendant la période active réduiraient alors de nouveau la dette. À éviter sans plan.

## 6. Retours de marchandises : fermés aux chauffeurs

Décision métier (`lib/driver-returns-policy.ts`) : un chauffeur ne crée ni ne consulte de retour de marchandises ; les retours sont saisis au bureau.

- `DRIVER_GOODS_RETURNS_ENABLED = false` ;
- `POST /api/driver/returns` répond **403 pour tous les rôles**, après le contrôle de module et sans lire le corps de la requête ;
- `createDriverReturn` commence par la même garde (code conservé, inatteignable) ;
- `getReturnableProductsForCustomer` (`/api/credit-notes/returnables`) est réservée aux rôles bureau ; la lecture de l'historique d'achats d'un client, auparavant ouverte aux chauffeurs, est fermée ;
- liste, détail, validation et contre-passation des avoirs sont réservés aux rôles bureau ;
- rien n'est supprimé : les retours chauffeur historiques restent en base, lisibles et contre-passables par le bureau, et la fiche de stock de tournée continue de les compter.

## 7. Tests

| Fichier | Tests | Couvre |
|---|---|---|
| `lib/credit-note-debt-rule.test.ts` | 12 | règle, bornes, plancher, constante `null` |
| `lib/server/driver-goods-returns-closed.test.ts` | 7 | fermeture chauffeur (statique) |
| `components/credit-notes/credit-notes-lot1-wiring.test.ts` | 5 | branchement de l'interface du lot 1 |
| `components/dashboard/receivables/receivables-cash-refunds.test.tsx` | 8 | libellés, compteurs, notes Créances |
| `lib/server/credit-notes.integration.test.ts` | 26 | rôles, justification, prix caissier, dépôt, idempotence, validation, contre-passation |
| `lib/server/credit-notes.http.integration.test.ts` | 15 | routes réelles : session, CSRF, module, isolation entre organisations |
| `lib/server/credit-notes.driver-access.http.integration.test.ts` | 6 | chauffeur refusé partout, anciens retours lisibles par le bureau |
| `lib/server/customer-debt-cutover.integration.test.ts` | 8 | anciens et nouveaux avoirs, parité des deux calculs, détail, FIFO |
| `lib/server/customer-debt-cutover.flows.integration.test.ts` | 5 | plafonds de crédit, règlements, annulation et révision de vente |

Les 4 premiers (sans base) passent avec `npx tsx --test <fichier>`. Ceux qui portent `integration` exigent une base PostgreSQL jetable : ils **s'ignorent d'eux-mêmes** si `D2_TEST_DATABASE_URL` n'est pas la base `commdis_d2_test`. Ne les lancez donc pas à la main : utilisez la commande suivante.

### Lancer les tests de base de données

Prérequis : un PostgreSQL **local** (port 5432) et un utilisateur autorisé à créer une base.

```bash
# PowerShell : $env:COMDIS_TEST_DB_ADMIN_URL = "postgresql://utilisateur:motdepasse@localhost:5432/postgres"
export COMDIS_TEST_DB_ADMIN_URL="postgresql://utilisateur:motdepasse@localhost:5432/postgres"

npm run test:db:check      # valide la configuration, ne crée rien
npm run test:db            # crée la base jetable, applique les migrations, lance tous les tests, la supprime
npm run test:db -- lib/server/credit-notes.integration.test.ts   # un seul fichier
npm run test:db -- --timeout-ms=300000                           # autre délai maximal par fichier
npm run test:db:cleanup    # supprime une base jetable laissée par une exécution interrompue
npm run test:db:cleanup -- --owner-token=<jeton>                 # idem, propriété confirmée à la main (voir ci-dessous)
npm run test:db:script     # tests du script lui-même (sans aucune base : faux client PostgreSQL, faux processus, dossiers temporaires)
```

Délai maximal par fichier : 600 000 ms par défaut, modifiable avec `--timeout-ms=<n>` ou la variable `COMDIS_TEST_DB_TIMEOUT_MS` (entre 1 000 et 3 600 000). Il s'applique aussi à la migration.

`scripts/test-db.mjs` (la logique est dans `scripts/test-db/core.mjs`) :

- **exige** `COMDIS_TEST_DB_ADMIN_URL` (jamais lue dans `.env`) et refuse sans elle (code 2) ; refuse tout argument inconnu, répété ou incompatible (code 2) au lieu de lancer une suite complète ;
- refuse tout hôte non local, tout port autre que 5432, tout paramètre de connexion pouvant rediriger la connexion (`host=`, `hostaddr=`, `dbname=`…), toute URL portant un marqueur Neon, Vercel ou cloud, un serveur non bouclé ou en réplique ;
- **propriété** : ne crée et ne supprime que `commdis_d2_test`. Chaque exécution grave dans le commentaire de la base un marqueur `v3` : jeton aléatoire, **OID de la base créée**, pid, machine (nom nettoyé) et heure. L'OID est lu juste après le `CREATE DATABASE`, sous le verrou. La base n'est supprimée **que si** le jeton y figure encore, que l'OID du marqueur est bien l'OID propre de la base (un commentaire copié sur une autre base est détecté) et que l'OID est toujours celui créé par cette exécution (une base remplacée sous le même nom est détectée) ; le nom seul ne suffit jamais. Une base de ce nom qui n'a pas été créée par le script (sans marqueur `v3` valide) n'est jamais touchée ;
- **concurrence** : `test:db` et `test:db:cleanup` prennent un verrou consultatif PostgreSQL sur la connexion d'administration et se refusent mutuellement tant que l'autre tourne ;
- **base abandonnée** : `test:db` refuse de démarrer et indique la commande de récupération. `test:db:cleanup` ne supprime que si (1) le commentaire porte un marqueur `v3` valide dont l'OID est celui de la base, (2) la propriété est prouvée par l'enregistrement local écrit par `test:db` (même jeton, même machine, même pid, OID cohérent) **ou**, si cet enregistrement est absent, invalide ou contradictoire, confirmée explicitement par `--owner-token=<jeton>` (le jeton est affiché au début de chaque exécution et dans le message de refus), et (3) le processus propriétaire n'est plus en vie. Au moindre doute il refuse, sans rien supprimer, en donnant la raison ;
- **enregistrement local** (`scripts/test-db/state-store.mjs`) : un dossier privé de l'utilisateur, jamais le dossier temporaire partagé : `%LOCALAPPDATA%\comdis\test-db` sous Windows, `$XDG_STATE_HOME` ou `~/.local/state`, puis `comdis/test-db`, sous Linux et macOS. Création exclusive (le fichier ne doit pas exister ; un lien symbolique n'est jamais suivi), mises à jour atomiques (fichier temporaire exclusif puis renommage), suppression seulement avec le jeton de l'enregistrement. Sous POSIX : dossier en 0700, fichier en 0600, propriétaire vérifié et refus de tout fichier ou dossier lisible par d'autres ; sous Windows, la protection est l'ACL privée du profil utilisateur (les modes POSIX n'existent pas). L'enregistrement d'une exécution encore vivante n'est jamais écrasé : une seconde exécution est refusée avant tout `CREATE DATABASE` ;
- **environnement des tests** : liste blanche de variables système plus `DATABASE_URL`, `DIRECT_URL` et `D2_TEST_DATABASE_URL` forcées vers la base jetable. Les variables `PG*`, `NODE_OPTIONS`, les autres URL de base de données et `COMDIS_TEST_DB_ADMIN_URL` ne sont pas transmises, et `.env` n'est pas lu par les processus de test (`DOTENV_CONFIG_PATH` pointe vers un fichier vide). Une vérification finale refuse de démarrer si l'URL d'administration, son mot de passe hors URL jetable, une autre URL PostgreSQL ou le point d'accès de production connu (`lib/production-endpoint.ts`) se trouvait dans cet environnement ;
- applique `prisma migrate deploy` sur cette seule base, puis lance chaque fichier de test dans son propre processus ;
- **signaux** (`SIGINT`, `SIGTERM`, `SIGHUP`, `SIGBREAK`) : après le premier signal, aucun nouveau fichier ne démarre, l'arbre complet du processus de test en cours est arrêté (`taskkill /T` sous Windows, groupe de processus sous Linux) et attendu, puis la base est supprimée et le script sort en code 130. Un second signal sort immédiatement en affichant la commande de récupération ;
- n'ignore jamais rien en silence : un test ignoré, échoué, annulé ou absent, un dépassement de délai, une migration en échec ou un nettoyage en échec font échouer l'exécution (code 1, résultat `FAIL`) ; le résumé liste, par fichier, tests / réussis / échoués / ignorés.

Limites du nettoyage :

- La suppression de la base est garantie pour les échecs applicatifs, les délais dépassés et les interruptions que Node peut intercepter. Elle **ne l'est pas** après un arrêt forcé (`kill -9`, `taskkill /F`, fermeture brutale), une coupure de courant ou un plantage de la machine, ni sous Windows pour `SIGTERM` et les arrêts envoyés hors console (Node ne les laisse pas intercepter). La base reste alors, et la prochaine exécution refuse de démarrer en donnant la commande `npm run test:db:cleanup`.
- Si le nettoyage échoue, le script le dit (`CLEANUP NOT GUARANTEED`), affiche la commande de récupération et sort en code non nul.
- **Écriture du marqueur** : le commentaire est tenté 3 fois au plus ; un `COMMENT` appliqué mais dont la réponse est perdue est reconnu à son marqueur exact (jeton + OID). Si l'écriture échoue quand même, la récupération automatique ne supprime la base que si elle porte encore **exactement l'OID capturé après la création** et aucun commentaire étranger. Si l'OID n'a pas pu être lu, s'il a changé, si un commentaire étranger ou le marqueur d'une autre exécution est apparu, rien n'est supprimé : le script affiche la procédure manuelle (vérifier l'OID par `select oid from pg_database where datname = 'commdis_d2_test'`, puis `DROP DATABASE`), et `test:db:cleanup` refusera lui aussi cette base faute de marqueur. Reste une fenêtre de quelques millisecondes entre la fin du `CREATE` et la lecture de l'OID, que PostgreSQL ne permet pas de fermer (aucun `DROP` conditionnel).
- Le verrou est pris dans la base d'administration indiquée par l'URL ; deux utilisateurs qui visent des bases d'administration différentes sont tout de même arrêtés par l'existence de `commdis_d2_test`, mais pas par le verrou.
- Les tests tournent avec le même rôle PostgreSQL que la connexion d'administration (l'URL jetable en reprend les identifiants) : ils ne peuvent pas en être isolés ; chaque fichier de test refuse en plus de s'exécuter sur une autre base que `commdis_d2_test`.
- La gestion des signaux est couverte par des tests unitaires (arrêt demandé pendant un test, aucun nouveau lancement, arbre de processus tué, délai) et par des essais réels d'arrêt forcé et de délai ; un vrai Ctrl-C en console n'a pas été exercé automatiquement.

Le dossier `scripts/test-db/stubs/server-only/` remplace le paquet `server-only` (absent de `node_modules`, remplacé par Next au build) pour les seuls tests, via `NODE_PATH`.

### Les neuf fichiers `*.db.test.ts` (et sept autres tests) : base de développement, hors de la base jetable

Neuf fichiers existants ne passent **pas** par `npm run test:db` et ne s'exécutent **pas** sur la base jetable : ils chargent `.env` (`dotenv/config`) et se connectent à la `DATABASE_URL` qui s'y trouve, c'est-à-dire la base de développement. Ils sont lancés par une exécution `tsx --test` générale, et **s'ignorent d'eux-mêmes sans erreur** si cette base est injoignable ou vide.

| Fichier | Écritures |
|---|---|
| `lib/forecasting/product-daily-sales.db.test.ts`, `purchase-forecast-cache.db.test.ts`, `purchase-recommendation.db.test.ts`, `sales-forecast.db.test.ts` | transactions annulées (rollback) |
| `lib/modules/module-access.db.test.ts`, `lib/table-columns/preferences.db.test.ts` | transactions annulées (rollback) |
| `lib/server/import-export.db.test.ts`, `lib/server/truck-loading-stock.db.test.ts` | transactions annulées (rollback) |
| `lib/server/products-import-variants.db.test.ts` | lecture seule (uniquement des `SELECT`, compte les lignes avant et après) |

**Garde contre la production** (`lib/db-test-guard.ts`, sans `server-only`, qui réutilise `lib/production-endpoint.ts` ; `lib/server/env-guard.ts` n'est pas réutilisable tel quel car il importe `server-only`, absent de `node_modules`) : chacun de ces fichiers appelle `assertDevDatabaseOnly(...)` **avant** de créer son `PrismaClient`, puis `assertLoopbackServer(prisma, ...)` en première instruction de son hook d'initialisation.

- Refus (le fichier de test échoue, il ne s'ignore pas) si : `APP_ENV=production` ; `VERCEL_ENV` vaut `production` ou `preview` ; `DATABASE_URL` ou `DIRECT_URL` contient le point d'accès de production connu ; l'hôte de `DATABASE_URL` n'est pas local (`localhost`, `127.0.0.1`, `::1`), donc toute base hébergée ; le protocole n'est pas PostgreSQL ; l'URL porte un paramètre pouvant rediriger la connexion (`host`, `hostaddr`, `service`, `options`, `port`, `dbname`…) ; sans URL, `PGHOST` ou `PGHOSTADDR` pointe hors de cette machine.
- Une fois connecté, le serveur PostgreSQL doit répondre depuis une adresse locale (un port local redirigé vers un serveur hébergé passe le contrôle d'URL mais pas celui-ci). Un serveur injoignable n'est pas une erreur : il n'y a rien à protéger et le test s'ignore comme avant.
- Ces gardes sont testées sans base (`lib/db-test-guard.test.ts`), y compris un test statique qui vérifie, pour les neuf fichiers et tout futur `*.db.test.ts`, l'import de la garde, son appel avant `new PrismaClient` et le contrôle du serveur dans le hook d'initialisation.
- Ils restent des tests de la base de développement : ils ne sont pas exécutés par `npm run test:db`, et la garde ne les rend pas jetables, elle empêche seulement qu'ils visent la production ou une base hébergée. La même garde s'applique aux sept tests décrits plus bas.

**Sept autres tests de la base de développement, avec la même garde** : sept tests qui ne portent pas le suffixe `.db.test.ts` se connectent eux aussi à la `DATABASE_URL` de `.env` (même schéma : un `PrismaClient` propre au fichier, toutes les écritures dans une transaction qui lève toujours `Rollback`, jamais d'écriture directe par `prisma.*`, aucun import du client partagé de l'application). Ils ont reçu exactement la même garde que les neuf fichiers (import, `assertDevDatabaseOnly(...)` avant la construction du client, `assertLoopbackServer(...)` en première instruction du hook `before`, sans toucher aux transactions, aux données de test ni à la logique) : `lib/server/assistant-pos-draft-tool.test.ts`, `assistant-purchase-tool.test.ts`, `client-portal-core.test.ts`, `commercial-analysis.test.ts`, `pos-product-ranking.test.ts`, `receivables.test.ts` et `sales-discount-indicator.test.ts`.

Le test statique (`lib/db-test-guard.test.ts`) vérifie ces 16 fichiers : garde importée, appelée une seule fois et nommant son propre fichier, exécutée avant la création du client, aucun usage de Prisma avant le hook d'initialisation, contrôle du serveur en première instruction de ce hook. Il n'y a plus de liste d'exceptions : tout test de `lib/` qui construit un `PrismaClient` sans cette garde (ni la barrière de la base jetable `D2_TEST_DATABASE_URL`) fait échouer la vérification. Ces tests restent des tests de la base de développement locale : la garde empêche qu'ils visent la production ou une base hébergée, elle ne les rend pas jetables. Ne lancez jamais une exécution générale avec une `DATABASE_URL` hébergée dans `.env`.

Les tests de base de données de ce document (`*.integration.test.ts`) sont ceux que `npm run test:db` exécute : six fichiers et 75 tests au moment de la rédaction.

## 8. Limites connues

- **Documentation / lot 3** : l'interface des avoirs actuelle (modes « lié à une facture » et « manuel », onglet Historique) n'est pas refondue ; le lot 3 n'est pas commencé.
- **Date de bascule** : `null`. Tant qu'elle l'est, un remboursement en espèces réduit la dette comme avant.
- **Comportements durcis** : la clé d'idempotence est obligatoire pour un nouvel avoir (appelant d'API sans clé : 422) ; la justification de 5 caractères s'applique à tous les rôles.
- **Brouillons** : n'importe quel rôle bureau peut modifier un brouillon et le type d'un brouillon (client / fournisseur) peut changer à la modification ; aucun contrôle ni changement n'a été ajouté.
- **Menu** : « Avoir client / fournisseur » n'est proposé qu'à `admin` et `cashier`, pas au `depot_manager`, qui y accède par l'adresse.
- **Texte d'aide** : `CASH_NOTE_HINT` (« jamais choisie à la saisie ») s'affiche encore pour les anciens avoirs espèces, alors que le mode est maintenant choisissable à la saisie.
- **Compte client** : un avoir `BANK` crédite le compte client générique et non le compte auxiliaire du client (limite comptable antérieure).
- **Cache** : `Customer.currentBalance` n'est pas recalculé par ces lots (écart préexistant).
- **Code conservé** : `createDriverReturn`, `components/avoirs/*` (ancienne interface inutilisée).
- **Pas de test navigateur complet** : l'application n'a pas été exercée de bout en bout dans un navigateur connecté ; le rendu a été vérifié sur les vrais composants avec les données des vrais chargeurs.
- **Audit sur copie de production** : la preuve qu'une bascule postérieure ne change aucun solde existant (1 233 comparaisons client × date identiques) a été faite par une sonde hors dépôt sur une restauration locale, et n'est pas un test permanent ; le dépôt la couvre par des données synthétiques et un test unitaire sur les 4 dates historiques.

## 9. Précautions avant une mise en production

1. Publier les lots 1 et 2 ensemble ; décider de leur ordre par rapport au lot 3.
2. Aucune migration n'est requise par ces lots (aucun changement de schéma) ; aucune donnée à rattraper.
3. Exécuter `npm run test:db`, `npm run test:db:script`, les tests sans base, `npx tsc --noEmit` et `npm run lint` sur le commit à publier.
4. Prendre une sauvegarde de production fraîche et vérifier la santé de la sauvegarde avant la fusion.
5. Contrôler un aperçu (preview) : saisie d'un avoir espèces et d'un avoir sur compte par un caissier, un responsable de dépôt et un administrateur ; refus d'un retour par un chauffeur.
6. Appliquer la procédure d'activation (§5) au moment choisi, jamais avant.
7. Garder en tête le retour arrière décrit au §5.6.

## 10. Résultats de validation (2026-10-14, avant publication)

Relevé des vérifications réellement exécutées sur le code de ce document. Aucune n'a utilisé la production.

| Vérification | Résultat |
|---|---|
| Tests sans base de données (120 fichiers : règles, interface, architecture, garde, Lots 1 et 2) | 1 399 tests, 1 399 réussis, 0 échec, 0 ignoré |
| `npm run test:db` (base jetable locale, 57 migrations, 6 fichiers) | 75 tests, 75 réussis, 0 échec, 0 ignoré ; base supprimée ; code de sortie 0 |
| `npm run test:db:script` (script lui-même, sans base) | 61 tests, 60 réussis, 0 échec, 1 ignoré (modes POSIX 0700/0600, inexistants sous Windows) |
| `lib/db-test-guard.test.ts` (garde contre la production + test statique des 16 fichiers) | 10 tests, 10 réussis |
| `npx tsc --noEmit` | 0 erreur |
| `npm run lint` | 0 erreur, 7 avertissements déjà présents avant ces lots (dont `requireSessionUser` inutilisé dans `credit-notes.ts`, présent dans HEAD) |
| `git diff --check` | code de sortie 0 |
| Audit sur une copie locale des données de production du 2026-10-14 (lecture seule, hors dépôt) | 1 233 comparaisons client × date de bascule identiques ; soldes −292,47 DH et 3 533,70 DH inchangés |

Non exécuté, à faire avant la mise en production : `next build` complet, parcours dans un navigateur connecté (Preview), exécution des 16 tests de la base de développement après l'ajout de leur garde (ils sont vérifiés statiquement, voir §7), vérification en lecture seule de la date du dernier avoir validé en production avant d'activer la bascule (§5).
