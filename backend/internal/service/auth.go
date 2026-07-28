package service

import (
	"errors"
	"time"

	"github.com/codefun/tagmanager/backend/internal/domain"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type TokenClaims struct {
	Role domain.Role `json:"role"`
	jwt.RegisteredClaims
}

func HashPassword(value string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(value), bcrypt.DefaultCost)
	return string(bytes), err
}
func VerifyPassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

func IssueToken(secret, userID string, role domain.Role) (string, error) {
	claims := TokenClaims{Role: role, RegisteredClaims: jwt.RegisteredClaims{Subject: userID, ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)), IssuedAt: jwt.NewNumericDate(time.Now())}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func ParseToken(secret, raw string) (TokenClaims, error) {
	claims := TokenClaims{}
	token, err := jwt.ParseWithClaims(raw, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return TokenClaims{}, errors.New("invalid token")
	}
	return claims, nil
}

func ValidatePasswordStrength(password string) error {
	if len(password) < 12 {
		return errors.New("password must be at least 12 characters long")
	}
	var (
		hasUpper   bool
		hasLower   bool
		hasNumber  bool
		hasSpecial bool
	)
	for _, ch := range password {
		switch {
		case 'A' <= ch && ch <= 'Z':
			hasUpper = true
		case 'a' <= ch && ch <= 'z':
			hasLower = true
		case '0' <= ch && ch <= '9':
			hasNumber = true
		default:
			hasSpecial = true
		}
	}
	if !hasUpper || !hasLower || !hasNumber || !hasSpecial {
		return errors.New("password must contain uppercase, lowercase, digit, and special character")
	}
	return nil
}
