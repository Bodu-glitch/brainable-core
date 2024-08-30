import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

interface Room {
  hostId: string;
  players: { [socketId: string]: string };
  questions: {
    questionId: string;
    correctAnswer: number;
    answers: {
      [playerName: string]: {
        answer: number,
        time: number,
        score: number
      }
    };

  }[];
}

@WebSocketGateway({ cors: true })
export class GameGateway {
  @WebSocketServer()
  server: Server;

  private rooms: { [pin: string]: Room } = {};
  private currentQuestion: number = 0;

  @SubscribeMessage("createRoom")
  handleCreateRoom(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    this.rooms[pin] = {
      hostId: client.id,
      players: {},
      questions: []
    };
    client.join(pin);
    console.log(`Room ${pin} created by host ${client.id}`);
  }

  @SubscribeMessage("joinRoom")
  handleJoinRoom(
    @MessageBody() data: { pin: string; username: string },
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[data.pin];
    if (room) {
      client.join(data.pin);
      room.players[client.id] = data.username;
      console.log(`${data.username} joined room ${data.pin}`);
      this.server
        .to(room.hostId)
        .emit("guestJoined", { username: data.username });
    } else {
      client.emit("error", "Room not found");
    }
  }

  @SubscribeMessage("checkRoomExist")
  handleCheckRoomExist(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (!room) {
      client.emit("error", "Room not found");
    } else {
      this.server.to(client.id).emit("navigateToEnterName");
      console.log(`Room ${pin} exists`);
    }
  }

  @SubscribeMessage("startGame")
  handleStartGame(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (room && room.hostId === client.id) {
      this.server.to(pin).emit("navigateToCountDown");
      console.log(`Game started in room ${pin}`);
    } else {
      console.log("Unauthorized: Only the host can start the game.");
      client.emit("error", "Only the host can start the game.");
    }
  }

  @SubscribeMessage("showAnswer")
  handleCountdown(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (room && room.hostId === client.id) {
      this.server.to(pin).emit("chooseAnswer");
      console.log(`Countdown started in room ${pin}`);
    } else {
      console.log("Unauthorized: Only the host can start the countdown.");
      client.emit("error", "Only the host can start the countdown.");
    }
  }

  @SubscribeMessage("sendQuestion")
  handleSendQuestion(
    @MessageBody()
      data: {
      pin: string;
      questionId: string;
      correctAnswer: number;
    },
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[data.pin];
    if (room && room.hostId === client.id) {
      // Thêm câu hỏi vào danh sách
      room.questions.push({
        questionId: data.questionId,
        correctAnswer: data.correctAnswer,
        answers: {}
      });

      // Gửi câu hỏi cho tất cả người chơi
      this.server.to(data.pin).emit("receiveQuestion", data.questionId);
      console.log(
        `Question ${data.questionId} sent to room ${data.pin} with correct answer ${data.correctAnswer}`
      );
    } else {
      console.log("Unauthorized: Only the host can send a question.");
      client.emit("error", "Only the host can send a question.");
    }
  }

  @SubscribeMessage("sendAnswer")
  handleSendAnswer(
    @MessageBody()
      data: {
      pin: string;
      questionId: string;
      playerName: string;
      answer: number;
      time: number;
    },
    @ConnectedSocket() client: Socket
  ): void {
    try {
      const room = this.rooms[data.pin];
      if (!room) {
        client.emit("error", "Room not found");
        return;
      }

      const question = room.questions.find(
        (q) => q.questionId === data.questionId
      );
      if (!question) {
        client.emit("error", "Question not found");
        return;
      }

      if (!question.answers[data.playerName]) {
        question.answers[data.playerName] = { answer: 0, time: 0, score: 0 };
      }

      question.answers[data.playerName].answer = data.answer;
      question.answers[data.playerName].time = data.time;

      if (question.correctAnswer === data.answer) {
        const newScore = Math.round((1 / data.time) * 100000);
        if (this.currentQuestion === 0) {
          question.answers[data.playerName].score = newScore;
        } else {
          const previousScore = room.questions[this.currentQuestion - 1].answers[data.playerName]?.score || 0;
          const totalScore = newScore + previousScore;

          // Ensure the total score does not exceed the maximum safe integer value
          if (totalScore > Number.MAX_SAFE_INTEGER) {
            question.answers[data.playerName].score = Number.MAX_SAFE_INTEGER;
          } else {
            question.answers[data.playerName].score = totalScore;
          }
        }
      } else {
        if (this.currentQuestion === 0) {
          question.answers[data.playerName].score = 0;
        } else {
          question.answers[data.playerName].score = room.questions[this.currentQuestion - 1].answers[data.playerName]?.score || 0;
        }
      }

      this.server.to(data.pin).emit("playerSubmittedAnswer");
    } catch (error) {
      console.log(error);
      client.emit("error", "An error occurred while processing the answer");
    }
  }

  @SubscribeMessage("nextQuestion")
  handleNextQuestion(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    this.currentQuestion++;
    if (room && room.hostId === client.id) {
      this.server.to(pin).emit("navigateToNextQuestion");
      console.log(`Next question started in room ${pin}`);
    } else {
      console.log("Unauthorized: Only the host can start the countdown.");
      client.emit("error", "Only the host can start the countdown.");
    }
  }

  @SubscribeMessage("nextShowResults")
  handleNextShowResults(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (room && room.hostId === client.id) {
      this.server.to(pin).emit("navigateToResults");
      console.log(`Next show results started in room ${pin}`);
    } else {
      console.log("Unauthorized: Only the host can start the countdown.");
      client.emit("error", "Only the host can start the countdown.");
    }
  }

  @SubscribeMessage("showResults")
  handleShowResult(
    @MessageBody()
      data: {
      pin: string;
      questionId: string;
    },
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[data.pin];
    if (room && room.hostId === client.id) {
      // Tìm câu hỏi trong danh sách
      const question = room.questions.find(
        (q) => q.questionId == data.questionId
      );
      // Gửi thống kê số lượng người chơi chọn từng đáp án về cho host
      const answerStatistics = this.calculateAnswerStatistics(question);
      this.server.to(room.hostId).emit("answerStatistics", {
        answerStatistics: answerStatistics
      });

      // Gửi lại đáp án đúng cho tất cả người chơi
      this.server.to(data.pin).emit("correctAnswer", {
        correctAnswer: question.correctAnswer
      });
    } else {
      console.log("Unauthorized: Only the host can show the result.");
      client.emit("error", "Only the host can show the result.");
    }
  }

  @SubscribeMessage("showTop5")
  handleShowTop10(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (room && room.hostId === client.id) {
      // show top 10 score in room
      let leaderboard = this.calculateLeaderboard(room);
      // if (leaderboard.length > 5) {
      //   leaderboard = leaderboard.slice(0, 5);
      // }
      this.server.to(room.hostId).emit("leaderboardTop5", leaderboard);
      console.log(`Leaderboard sent to room ${pin}`);
    } else {
      console.log("Unauthorized: Only the host can show the leaderboard.");
      client.emit("error", "Only the host can show the leaderboard.");
    }
  }

  private calculateAnswerStatistics(question: {
    questionId: string;
    correctAnswer: number;
    answers: {
      [playerName: string]: {
        answer: number,
        time: number,
      }
    };
  }) {
    const statistics: { [answer: string]: number } = {
      1: 0,
      2: 0,
      3: 0,
      4: 0
    };

    Object.values(question.answers).forEach((answer) => {
      if (!statistics[answer.answer]) {
        statistics[answer.answer] = 0;
      }
      statistics[answer.answer] += 1;
    });

    return statistics;
  }

  @SubscribeMessage("endGame")
  handleEndGame(
    @MessageBody() pin: string,
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[pin];
    if (room && room.hostId === client.id) {
      const leaderboard = this.calculateLeaderboard(room);
      this.server.to(room.hostId).emit("questionList", leaderboard);
      this.currentQuestion = 0;
      console.log(`Game ended in room ${pin}. Leaderboard sent.`);
    } else {
      console.log("Unauthorized: Only the host can end the game.");
      client.emit("error", "Only the host can end the game.");
    }
  }

  calculateLeaderboard(room: Room) {
    const scores: { [playerName: string]: number } = {};

    room.questions.forEach((question) => {
      Object.entries(question.answers).forEach(([playerName, answerData]) => {
        // Update the player's score with the score from the last question
        scores[playerName] = answerData.score;
      });
    });
    console.log(scores);

    // Sort the leaderboard by score in descending order and round the results
    return Object.entries(scores)
      .map(([playerName, score]) => ({ playerName, score: Math.round(score) }))
      .sort((a, b) => b.score - a.score);
  }

  @SubscribeMessage("getLastQuestionScore")
  handleGetLastQuestionScore(
    @MessageBody() data: { pin: string, gameId: string },
    @ConnectedSocket() client: Socket
  ): void {
    const room = this.rooms[data.pin];
    if (room) {
      const results = this.getLastQuestionScore(room, data.gameId);
      console.log(results);
      this.server.to(room.hostId).emit("lastQuestionScore", results);
    } else {
      client.emit("error", "Room not found");
    }
  }

  private getLastQuestionScore(room: Room, gameId: string): {
    gameId: string,
    score: number,
    correctCount: number,
    incorrectCount: number,
    noAnswerCount: number,
    playerName: string
  }[] {
    const results = [];
    const lastQuestion = room.questions[room.questions.length - 1]; // Lấy câu hỏi cuối cùng
    const correctCounts: { [playerName: string]: number } = {};
    const incorrectCounts: { [playerName: string]: number } = {};
    const noAnswerCounts: { [playerName: string]: number } = {};

    room.questions.forEach((question) => {
      Object.entries(question.answers).forEach(([playerName, answerData]) => {
        if (answerData.answer === question.correctAnswer) {
          correctCounts[playerName] = (correctCounts[playerName] || 0) + 1;
        } else if (answerData.answer === 0) {
          noAnswerCounts[playerName] = (noAnswerCounts[playerName] || 0) + 1;
        } else {
          incorrectCounts[playerName] = (incorrectCounts[playerName] || 0) + 1;
        }
      });
    });

    // Đẩy thông tin từ câu hỏi cuối cùng vào mảng
    Object.entries(lastQuestion.answers).forEach(([playerName, answerData]) => {
      if (answerData.score > 0) {
        results.push({
          gameId,
          score: answerData.score,
          correctCount: correctCounts[playerName] || 0, // Tổng số câu đúng
          incorrectCount: incorrectCounts[playerName] || 0, // Tổng số câu sai
          noAnswerCount: noAnswerCounts[playerName] || 0, // Tổng số câu không trả lời
          playerName
        });
      }
    });

    return results;
  }


  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    for (const pin in this.rooms) {
      const room = this.rooms[pin];
      if (room.hostId === client.id) {
        delete this.rooms[pin];
        this.server.to(pin).emit("error", "Host has left the game");
        this.server.in(pin).socketsLeave(pin); // Kick all players out of the room
        this.currentQuestion = 0;
        console.log(`Room ${pin} deleted because host disconnected`);
      } else if (room.players[client.id]) {
        const username = room.players[client.id];
        delete room.players[client.id];
        this.server.to(room.hostId).emit("guestLeft", { username });
        console.log(`${username} left room ${pin}`);
      }
    }
  }
}
