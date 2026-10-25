# Samsung Smart TV

## Présentation

Pilotez vos téléviseurs Samsung (Tizen, modèles 2016 et suivants) depuis Gladys, entièrement sur le réseau local :
aucun compte Samsung, aucun passage par le cloud.

### Ce que l'intégration expose

| Fonctionnalité | Détail                                                           |
| -------------- | ---------------------------------------------------------------- |
| Power          | Éteint la TV, et la rallume par Wake-on-LAN                      |
| Volume         | Curseur de 0 à 100 %, avec le niveau réel relu sur la TV         |
| Volume + / −   | Un cran de volume, comme sur la télécommande                     |
| Sourdine       | Activée ou coupée, sans effet de bascule                         |
| Source         | TV, HDMI, et les applications installées quand la TV les déclare |

### Sources et applications

TV et HDMI sont toujours proposées : ce sont des touches de la télécommande, présentes sur tous les modèles.

La liste des applications installées est demandée à la TV lors du scan, mais plusieurs modèles récents (2021 et
suivants) ignorent cette requête. Le cas échéant, seules TV et HDMI apparaissent — c'est le comportement attendu, pas
une panne. Relancez un scan après avoir installé une application : si votre modèle répond, elle sera ajoutée.

## Prérequis

- **Gladys 4.86 ou supérieur.**
- Un téléviseur Samsung sous Tizen, modèle 2016 ou plus récent.
- La TV connectée au même réseau local que Gladys : Gladys la trouve par un scan du réseau et la
  rallume avec un paquet Wake-on-LAN. Aucun compte Samsung n'est nécessaire.
- La télécommande de la TV, pour accepter la demande d'autorisation la première fois que Gladys
  envoie une commande.
- Pour rallumer la TV depuis Gladys : le réveil réseau activé sur la TV (voir « Rallumer la TV »).

## Configuration

1. **Allumez votre téléviseur**, puis ouvrez l'onglet **Découverte** et lancez un scan. Il apparaît sous son propre
   nom (« Samsung AU7025 55 TV », par exemple). Créez-le.

   Une TV en veille coupe son interface réseau : elle ne répond à rien et aucun scan ne peut la détecter. Un scan
   qui ne remonte rien est presque toujours un téléviseur éteint — allumez-le et relancez.

2. Actionnez une première commande, par exemple **Volume +**. La TV affiche alors une demande d'autorisation pour
   « Gladys » : **acceptez-la avec la télécommande**. Cela n'arrive qu'une seule fois, le jeton est ensuite conservé.

Si la TV ne demande rien et que les commandes échouent, vérifiez que
_Paramètres → Général → Gestionnaire de périphériques externes → Gestionnaire de connexion des périphériques_
autorise bien les nouveaux appareils.

## Rallumer la TV

Une TV éteinte ne répond plus sur le réseau : la seule façon de la réveiller est le Wake-on-LAN, un paquet que
Gladys émet vers son adresse MAC. Il faut pour cela activer le réveil réseau sur la TV, dans
_Paramètres → Général → Réseau → Paramètres experts → **Activer avec mobile**_ (le libellé varie selon les modèles :
« Allumage à distance », « Réveil par réseau »).

En Wi-Fi, ce réveil dépend du modèle et n'est pas garanti par tous les téléviseurs. Si l'allumage ne fonctionne pas
alors que l'option est active, une liaison Ethernet le rend fiable. L'extinction, elle, fonctionne dans tous les cas.

**Pour savoir où vous en êtes**, éteignez la TV puis, depuis une machine du réseau, lancez `ping <adresse IP de la TV>` :

- la TV répond encore : son interface réseau reste active en veille, le Wake-on-LAN a toutes ses chances ;
- la TV ne répond plus du tout : elle a coupé son interface réseau, aucun paquet ne peut plus l'atteindre et le
  réveil échouera. C'est le symptôme d'un réveil réseau désactivé — activez l'option ci-dessus, puis refaites le test.

## Rafraîchissement

L'intégration relit l'état allumé/éteint, le volume et la sourdine de chaque TV selon l'**Intervalle de
rafraîchissement** choisi dans les paramètres de l'intégration (toutes les 30 secondes par défaut, toutes les 10
secondes au plus rapide). Un changement fait avec la télécommande, ou une TV réveillée par Wake-on-LAN, apparaît dans
Gladys dans cet intervalle.

## Fonctionnement interne

Trois canaux, chacun pour ce qu'il fait de mieux :

- l'**API REST** de la TV (port 8001) donne l'état allumé/éteint, relu à chaque rafraîchissement ;
- l'**UPnP RenderingControl** (port 9197) lit et écrit le volume et la sourdine, sans jeton et sans ambiguïté ;
- le **WebSocket télécommande** (port 8002) transporte les touches, seule partie nécessitant l'autorisation.

Le jeton d'appairage est conservé dans le volume `/data` de l'intégration : il survit aux redémarrages et aux mises
à jour du conteneur.

## Dépannage

Les logs de l'intégration sont accessibles dans Gladys, depuis l'onglet **Configuration** de
l'intégration, avec les commandes de supervision (démarrer, arrêter, redémarrer…).

**Le scan ne trouve aucune TV** : la TV est presque toujours en veille (voir « Configuration »).
Allumez-la, patientez quelques secondes, puis relancez le scan. Les logs de l'intégration indiquent
alors
`No Samsung TV found. A television in standby is invisible on the network: turn it on, then run the scan again.`
Si la TV est bien allumée, vérifiez qu'elle est sur le même réseau local que Gladys.

**« Tester la connexion » répond « Aucune réponse de … : la TV est éteinte ou injoignable. »** : la
TV est éteinte, ou ne répond plus à l'adresse qu'elle avait quand vous l'avez créée. Allumez-la et
refaites le test ; si elle ne répond toujours pas, voyez le point suivant.

**La TV a changé d'adresse IP** : une TV dont votre box a réattribué l'adresse ne répond plus à
l'ancienne. Si une autre TV Samsung a pris cette adresse, les logs indiquent
`A different device (…) now answers at …, not …: rescan to pick up the new address of this TV`.
Allumez la TV et relancez un scan depuis l'onglet **Découverte** : la TV que vous avez créée
récupère sa nouvelle adresse. Pour éviter le problème, fixez son adresse IP dans votre box.

**Une commande échoue avec `Authorization was not granted on the TV at … within 30 s`** : la
demande d'autorisation n'a pas été acceptée à temps. Renvoyez la commande et acceptez la demande
avec la télécommande.

**Une commande échoue avec `The TV at … refused the connection (authorization denied)`** : la
demande a été refusée sur la TV. Vérifiez les réglages du _Gestionnaire de connexion des
périphériques_ décrits dans « Configuration », puis renvoyez une commande.

**Une commande échoue avec `The TV at … did not answer` ou `Connection to … failed: …`** : la TV
est éteinte, ou Gladys ne peut pas joindre son canal télécommande (port 8002, voir « Fonctionnement
interne »).

**La TV ne s'allume pas** : vérifiez l'option de réveil réseau et faites le test `ping` décrits dans
« Rallumer la TV ». Si la commande échoue avec
`This TV reported no MAC address: Wake-on-LAN is impossible`, allumez la TV avec la télécommande
et relancez un scan : son adresse MAC est relue.

**Le volume et la sourdine ne se mettent pas à jour alors que la TV est allumée** : les logs
indiquent `Could not read the volume of …: …`. La TV n'a pas répondu sur son canal UPnP (port 9197,
voir « Fonctionnement interne ») ; vérifiez que rien ne filtre ce port entre Gladys et la TV.

**Seules TV et HDMI apparaissent dans les sources** : c'est attendu sur plusieurs modèles récents,
voir « Sources et applications ».

**L'état de connexion indique « L'initialisation a échoué, consultez les logs de l'intégration. »**
: l'intégration n'a pas pu terminer son démarrage après s'être connectée à Gladys. Les logs en donnent la raison
(`Post-connection initialization failed`). Redémarrez l'intégration depuis son onglet
**Configuration**.
