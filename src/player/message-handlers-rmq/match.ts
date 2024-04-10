import Club from '../../database/models/club'
import ClubMember from '../../database/models/clubMember'
import PlayerModel from '../../database/models/player'
import majiangLobby from '../../match/majiang/centerlobby'
import xueliuLobby from '../../match/xueliu/centerlobby'
import {service} from "../../service/importService";
import {AsyncRedisClient} from "../../utils/redis"
import {ISocketPlayer} from "../ISocketPlayer"
import {GameType, TianleErrorCode} from "@fm/common/constants";

export function lobbyQueueNameFrom(gameType: string) {
  return `${gameType}Lobby`
}

const allGameName = ['majiang', 'xueliu']

function getLobby(gameType) {
  const gameType2Lobby = {
    majiang: majiangLobby,
    xueliu: xueliuLobby,
  }
  return gameType2Lobby[gameType] || gameType2Lobby.majiang
}

export function createHandler(redisClient: AsyncRedisClient) {

  return {
    'room/reconnect': async (player, message) => {
      const room = await service.roomRegister.getDisconnectedRoom(player.model._id.toString(), message.gameType);
      // console.warn("roomId %s gameType %s", room, message.gameType)
      if (room) {
        player.currentRoom = room
        player.setGameName(message.gameType)
        player.requestToCurrentRoom('room/reconnect')
      } else {
        player.sendMessage('room/reconnect', {ok: false, data: {}})
      }
    },

    // 玩家加入房间
    'room/join-friend': async (player, message) => {
      const roomInfo = await service.roomRegister.getRoomInfo(message._id);
      let resp;
      if (roomInfo.clubMode) {
        // 战队房
        const club = await Club.findById(roomInfo.clubId);
        if (!club) {
          return player.sendMessage('room/joinReply', {ok: false, info: TianleErrorCode.roomInvalid})
        }
        const unionMember = await service.club.getUnionMember(club.shortId, player.model._id);
        if (unionMember) {
          // 联盟战队
          const ownerClub = await service.club.getOwnerClub(player.model._id);
          if (ownerClub && ownerClub.shortId === unionMember.clubShortId) {
            // 战队主
            resp = await service.club.joinNormalClubRoom(roomInfo.gameRule, club._id, player.model._id);
          } else {
            resp = await service.club.joinUnionClubRoom(unionMember, roomInfo.gameRule, club._id, player.model._id);
          }
        } else {
          // 普通联盟战队
          resp = await service.club.joinNormalClubRoom(roomInfo.gameRule, club._id, player.model._id);
        }
        if (!resp.isOk) {
          return player.sendMessage('room/joinReply', resp.info);
        }
      }
      const roomExists = await service.roomRegister.isRoomExists(message._id)
      if (roomExists) {
        player.setGameName(message.gameType)
        // 加入房间
        player.requestToRoom(message._id, 'joinRoom', message)
      } else {
        player.sendMessage('room/joinReply', {reason: '房间不存在'})
      }
    },

    'room/login': async (player, message) => {
      const playerId = message.playerId;
      const gameType = message.gameType || "xueliu";
      player.model = await PlayerModel.findOne({_id: playerId}).lean();
      player.setGameName(gameType)
      await player.connectToBackend(gameType);

      // 下发掉线子游戏
      const room = await service.roomRegister.getDisconnectRoomByPlayerId(player.model._id.toString());
      if (room) {
        // 掉线的子游戏类型
        player.model.disconnectedRoom = true;
        player.model.continueGameType = GameType.mj;
      } else {
        // 没有掉线的房间号，不要重连
        player.model.disconnectedRoom = false
      }

      return player.sendMessage('room/loginReply', {ok: true, data: {model: player.model}})
    },

    'room/create': async (player, message) => {
      try {
        const rule = message.rule;
        const gameType = message.gameType;
        rule.gameType = gameType;
        const playerId = message.playerId;
        player.model = await PlayerModel.findOne({_id: playerId}).lean();
        console.warn("room create shortId-%s gameType-%s rule-%s lobby-%s", player.model.shortId, rule.gameType, JSON.stringify(rule), lobbyQueueNameFrom(gameType));
        return player.requestTo(lobbyQueueNameFrom(gameType), 'createRoom', {rule, gameType});
      } catch (e) {
        console.warn(e);
      }
    },

    'room/next-game': player => {
      player.requestToCurrentRoom('room/next-game');
    },
    'room/leave': player => {
      // if (!player.room) {
      //   return player.sendMessage("room/leaveReply", {ok: false, info: TianleErrorCode.roomIsFinish})
      // }

      player.requestToCurrentRoom('room/leave')
    },

    // 用户准备
    'room/ready': player => {
      player.requestToCurrentRoom('room/ready', {})
    },

    // 等待界面数据
    'room/awaitInfo': async player => {
      player.requestToCurrentRoom('room/awaitInfo', {})
    },

    // 洗牌&开始游戏
    'room/shuffleDataApply': async player => {
      player.requestToCurrentRoom('room/shuffleDataApply', {})
    },

    'room/creatorStartGame': player => {
      player.requestToCurrentRoom('room/creatorStartGame', {})
    },
    'room/sound-chat': (player, message) => {
      player.requestToCurrentRoom('room/sound-chat', message)
    },

    'room/buildInChat': (player, message) => {
      player.requestToCurrentRoom('room/buildInChat', message)
    },

    'room/addShuffle': player => {
      player.requestToCurrentRoom('room/addShuffle');
    },

    'room/dissolve': (player: ISocketPlayer) => {
      player.requestToCurrentRoom('room/dissolve')
    },

    'room/dissolveReq': (player: ISocketPlayer) => {
      player.requestToCurrentRoom('room/dissolveReq')
    },
    'room/AgreeDissolveReq': (player: ISocketPlayer) => {
      player.requestToCurrentRoom('room/AgreeDissolveReq')
    },
    'room/DisagreeDissolveReq': player => {
      player.requestToCurrentRoom('room/DisagreeDissolveReq')
    },
    'room/updatePosition': (player, message) => {
      player.requestToCurrentRoom('room/updatePosition', message)
    },

    'room/clubOwnerdissolve': async (player, message) => {
      const isAllow = await isOwnerOrAdmin(message.clubShortId, player.model._id);
      if (!isAllow) {
        // 非管理员或 owner
        player.sendMessage('sc/showInfo', {info: '无权执行解散操作！'})
        player.sendMessage('room/clubOwnerdissolveReply', {info: '无权执行解散操作！'})
        return
      }
      const roomExists = await service.roomRegister.isRoomExists(message._id)
      if (roomExists) {
        player.requestToRoom(message._id, 'dissolveClubRoom', {clubOwnerId: player.model._id})
      } else {
        player.sendMessage('room/join-fail', {reason: '房间不存在'})
      }
    },
    'room/forceDissolve': async (player, message) => {
      if (allGameName.findIndex(x => message.gameType === x) === -1) {
        player.sendMessage('sc/showInfo', {reason: '请输入正确的游戏类型'})
        return
      }
      const p = await PlayerModel.findOne({_id: 'super'}).lean()
      if (!p || !p.canUse || player._id !== p._id) {
        player.sendMessage('sc/showInfo', {reason: '无法使用'})
        return
      }

      const roomExists = await service.roomRegister.isRoomExists(message._id)

      if (roomExists) {
        player.requestToRoom(message._id, 'specialDissolve', {})
      } else {
        player.requestTo(`${message.gameType}DealQuestion`, 'clearRoomInfoFromRedis', {
          roomId: message._id, myGameType: player.gameName, gameType: message.gameType
        })
      }
    }
  }
}

// 是否创始人或者管理员
async function isOwnerOrAdmin(clubIdOrShortId, playerId) {
  // 检查是否创建者、管理员
  let myClub;
  if (typeof clubIdOrShortId === 'number') {
    myClub = await Club.findOne({ shortId: clubIdOrShortId});
  } else {
    // 用 id
    myClub = await Club.findById(clubIdOrShortId);
  }
  if (!myClub) {
    // 俱乐部不存在
    return false;
  }
  if (myClub.owner === playerId) {
    // 创建者
    return true;
  }
  const member = await ClubMember.findOne({ club: myClub._id, member: playerId });
  // 是成员且为管理员
  return member && member.role === 'admin';
}
