import {service} from "../../service/importService";
import {NewRobotManager} from "../base/newRobotManager";
import Enums from "./enums";
import {MJRobotRmqProxy} from "./robotRmqProxy";

// 机器人出牌
export class RobotManager extends NewRobotManager {
  // room: any
  disconnectPlayers: { [key: string]: MJRobotRmqProxy }

  // 创建机器人代理
  async createProxy(playerId) {
    const model = await service.playerService.getPlayerPlainModel(playerId);
    if (!model) {
      console.error('no model for', playerId)
    }
    return new MJRobotRmqProxy(model)
  }

  // 更新代理机器人等待出牌的时间
  async updateWaitPlayTime() {
    if (!this.room.gameState) {
      return;
    }
    const keys = Object.keys(this.disconnectPlayers);
    let proxy;
    for (const key of keys) {
      proxy = this.disconnectPlayers[key];
      if (this.isPlayerDa(proxy.model._id.toString()) || this.isPlayerGuo(proxy.model._id.toString())) {
        if (this.waitInterval[key]) {
          this.waitInterval[key]++;
        } else {
          this.waitInterval[key] = 1;
        }
      }
    }
  }

  checkIsRobot(player) {
    const keys = Object.keys(this.disconnectPlayers);
    let proxy;
    let flag = false;
    for (const key of keys) {
      proxy = this.disconnectPlayers[key];
      if (proxy.model._id.toString() === player._id.toString()) {
        flag = true;
        break;
      }
    }

    return flag;
  }

  // 出牌
  async playCard() {
    if (!this.room.gameState) {
      return;
    }

    const keys = Object.keys(this.disconnectPlayers);
    let proxy;
    let playerId;
    for (const key of keys) {
      proxy = this.disconnectPlayers[key];
      playerId = proxy.model._id.toString();
      const AnGangIndex = this.isPlayerAnGang(proxy.playerState);
      const buGangIndex = this.isPlayerBuGang(proxy.playerState);
      const isHu = proxy.playerState.checkZiMo();
      console.warn("game-state:", this.room.gameState.state);
      if (this.room.gameState.state !== 10) {
        if (this.isPlayerGang(playerId) && this.room.gameState.state === 2) {
          await proxy.gang(this.isPlayerGang(playerId))
        } else if (this.isPlayerChoice(playerId) && this.room.gameState.state === 2) {
          await proxy.choice(this.isPlayerChoice(playerId))
        } else if (this.isPlayerDa(playerId)) {
          if (this.waitInterval[key] >= this.getWaitSecond()) {
            if (isHu.hu) {
              await proxy.choice(Enums.hu)
            } else if (AnGangIndex) {
              await proxy.gang(Enums.anGang, AnGangIndex)
            } else if (buGangIndex) {
              await proxy.gang(Enums.buGang, buGangIndex)
            } else {
              await proxy.playCard();
            }

            this.waitInterval[key] = 0;
          }

          break;
        } else {
          // 过
          if (this.isPlayerGuo(playerId)) {
            await proxy.guo();
          }
        }
      } else {
        console.warn("await player invive")
      }

    }
  }

  // 打
  isPlayerDa(playerId) {
    return this.room.gameState.stateData[Enums.da] &&
      playerId === this.room.gameState.stateData[Enums.da]._id.toString()
  }

  isPlayerBuGang(player) {
    if (!Array.isArray(player.events.peng)) return false;
    for (const index in player.events.peng) {
      if (player.cards[player.events.peng[index]] > 0) {
        return player.events.peng[index];
      }
    }
    return false;
  }

  isPlayerAnGang(player) {
    for (const index in player.cards) {
      if (player.cards[index] === 4 && !isNaN(Number(index))) {
        return index;
      }
    }
    return false;
  }

  // 是不是能过
  isPlayerGuo(playerId) {
    const actionList = [Enums.chi];
    for (const action of actionList) {
      if (this.room.gameState.stateData[action] && playerId === this.room.gameState.stateData[action]._id.toString()) {
        return true;
      }
    }
    return false;
  }

  isPlayerGang(playerId) {
    const actionList = [Enums.gang, Enums.mingGang];
    for (const action of actionList) {
      if ([Enums.gang, Enums.mingGang].includes(action) && this.room.gameState.stateData[action]) {
        if (playerId === this.room.gameState.stateData[action]._id.toString()) {
          return action;
        }
      }
    }

    return false;
  }

  // 是否碰胡
  isPlayerChoice(playerId) {
    const actionList = [Enums.hu, Enums.peng];
    for (const action of actionList) {
      if ([Enums.peng].includes(action)
        && this.room.gameState.stateData[action] && playerId === this.room.gameState.stateData[action]._id.toString()) {
        return action;
      }
      if (action === Enums.hu && Array.isArray(this.room.gameState.stateData[action]) &&
        this.room.gameState.stateData[action].length > 0) {
        if (playerId === (Array.isArray(this.room.gameState.stateData[action]) ?
          this.room.gameState.stateData[action][0]._id.toString()
          : this.room.gameState.stateData[action]._id.toString())) return action;
      }
    }
    return false;
  }
}
