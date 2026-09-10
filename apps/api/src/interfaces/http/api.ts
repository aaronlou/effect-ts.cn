/**
 * interfaces/http · API 定义（Schema-first 声明，不含任何实现）
 *
 * 路由前缀 /api：
 *   GET  /api/health                    健康检查
 *   GET  /api/questions                 问题列表
 *   POST /api/questions                 提问
 *   GET  /api/questions/:id             问题详情
 */
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema
} from "@effect/platform"
import { Schema } from "effect"
import {
  AskQuestionDto,
  BadRequestError,
  HealthInfo,
  NotFoundError,
  QnaQuestionListDto,
  QuestionDto
} from "@ecn/contracts"

const idParam = HttpApiSchema.param("id", Schema.String)

/** system 组：健康检查 */
const SystemGroup = HttpApiGroup.make("system").add(
  HttpApiEndpoint.get("health", "/health").addSuccess(HealthInfo)
)

/** questions 组：QnA 上下文对外暴露的 HTTP 面 */
const QuestionsGroup = HttpApiGroup.make("questions")
  .add(
    HttpApiEndpoint.post("ask", "/questions")
      .setPayload(AskQuestionDto)
      .addSuccess(QuestionDto, { status: 201 })
      .addError(BadRequestError, { status: 400 })
  )
  .add(
    HttpApiEndpoint.get("list", "/questions").addSuccess(QnaQuestionListDto)
  )
  .add(
    HttpApiEndpoint.get("getById")`/questions/${idParam}`
      .addSuccess(QuestionDto)
      .addError(NotFoundError, { status: 404 })
  )

export const Api = HttpApi.make("effect-cn-api")
  .add(SystemGroup)
  .add(QuestionsGroup)
  .prefix("/api")
