package apperror

import (
	"fmt"
	"net/http"
)

type Error struct {
	HTTPStatus  int    `json:"-"`
	Code        string `json:"code"`
	Message     string `json:"message"`
	InternalErr error  `json:"-"`
}

func (e *Error) Error() string {
	if e.InternalErr != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.InternalErr)
	}
	return e.Message
}

func New(status int, code, message string, internalErr error) *Error {
	return &Error{
		HTTPStatus:  status,
		Code:        code,
		Message:     message,
		InternalErr: internalErr,
	}
}

func BadRequest(message string) *Error {
	return New(http.StatusBadRequest, "BAD_REQUEST", message, nil)
}

func Unauthorized(message string) *Error {
	return New(http.StatusUnauthorized, "UNAUTHORIZED", message, nil)
}

func Forbidden(message string) *Error {
	return New(http.StatusForbidden, "FORBIDDEN", message, nil)
}

func NotFound(message string) *Error {
	return New(http.StatusNotFound, "NOT_FOUND", message, nil)
}

func Conflict(message string) *Error {
	return New(http.StatusConflict, "CONFLICT", message, nil)
}

func Internal(message string, err error) *Error {
	return New(http.StatusInternalServerError, "INTERNAL_ERROR", message, err)
}
